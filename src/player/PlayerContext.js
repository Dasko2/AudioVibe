import { Audio, InterruptionModeAndroid } from "expo-av";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

import { addHistory, getDownload } from "../data/db";
import { getAudioStream, getHlsStream } from "../services/piped";
import { useSettings } from "../services/settings";

const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

export function PlayerProvider({ children }) {
  const { settings } = useSettings();
  const soundRef = useRef(null);
  const queueRef = useRef([]);

  const [current, setCurrent] = useState(null);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeat, setRepeat] = useState("off"); // off | one | all
  const [error, setError] = useState(null);
  const [bitrate, setBitrate] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Background playback + lock-screen continuation (Android foreground audio).
  useEffect(() => {
    Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      playThroughEarpieceAndroid: false,
    }).catch((e) => console.warn("[audio mode]", e?.message));

    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const onStatus = useCallback(
    (status) => {
      if (!status?.isLoaded) {
        // Propager les erreurs asynchrones de lecture (ex : -1005 MediaPlayer,
        // 403 ExoPlayer) qui surviennent après la résolution de createAsync.
        if (status?.error) {
          setError(status.error);
          setIsPlaying(false);
        }
        return;
      }
      setPosition(status.positionMillis || 0);
      setDuration(status.durationMillis || 0);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish && !status.isLooping) handleFinish();
    },
    [repeat, index]
  );

  const handleFinish = () => {
    const q = queueRef.current;
    if (repeat === "one") {
      soundRef.current?.replayAsync().catch(() => {});
      return;
    }
    if (index < q.length - 1) return playIndex(index + 1);
    if (repeat === "all" && q.length) return playIndex(0);
    setIsPlaying(false);
  };

  const loadTrack = async (track) => {
    setLoading(true);
    setError(null);
    try {
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;

      const offline = await getDownload(track.id);
      if (offline?.uri) {
        // Fichier téléchargé localement — lecture directe.
        const { sound } = await Audio.Sound.createAsync(
          { uri: offline.uri },
          { shouldPlay: true, progressUpdateIntervalMillis: 500 },
          onStatus
        );
        setBitrate(0);
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate(onStatus);
        activateKeepAwakeAsync("audiovibe-playback").catch(() => {});
        addHistory(track).catch(() => {});
        return;
      }

      let sound = null;
      let br = 0;

      // ── Stratégie 1 (Android) : HLS via client iOS ───────────────────────
      // Le manifest m3u8 n'est lié à aucun User-Agent : ExoPlayer le lit
      // nativement sans 403 ni erreur -1005.
      if (Platform.OS === "android") {
        try {
          const hls = await getHlsStream(track.id);
          ({ sound } = await Audio.Sound.createAsync(
            { uri: hls.url, overrideFileExtensionAndroid: "m3u8" },
            { shouldPlay: true, progressUpdateIntervalMillis: 500 },
            onStatus
          ));
          br = 0;
        } catch {
          sound = null;
        }
      }

      // ── Stratégie 2 : WebM/Opus via ExoPlayer + en-têtes ─────────────────
      // (principal sur iOS, fallback sur Android si HLS a échoué)
      if (!sound) {
        let headers;
        try {
          const stream = await getAudioStream(track.id, {
            hifi: !settings.dataSaver,
          });
          br = stream.bitrate;
          headers = stream.headers;
          // Les URL googlevideo sont liées au client qui les a demandées :
          // on passe les en-têtes pour qu'ExoPlayer ne reçoive pas un 403.
          ({ sound } = await Audio.Sound.createAsync(
            { uri: stream.url, headers, overrideFileExtensionAndroid: "webm" },
            { shouldPlay: true, progressUpdateIntervalMillis: 500 },
            onStatus
          ));
        } catch (exoError) {
          sound = null;

          // ── Stratégie 3 (Android uniquement) : HLS de secours ──────────
          // Si ce n'est pas déjà la plateforme Android, on s'arrête ici.
          if (Platform.OS !== "android") throw exoError;

          try {
            const hls = await getHlsStream(track.id);
            ({ sound } = await Audio.Sound.createAsync(
              { uri: hls.url, overrideFileExtensionAndroid: "m3u8" },
              { shouldPlay: true, progressUpdateIntervalMillis: 500 },
              onStatus
            ));
            br = 0;
          } catch {
            sound = null;
          }

          // ── Stratégie 4 (Android uniquement) : MediaPlayer sans en-têtes ─
          // Dernier recours : certaines URL googlevideo passent directement
          // quand on retire les en-têtes personnalisés (la signature est dans
          // l'URL elle-même).
          if (!sound) {
            const fresh = await getAudioStream(track.id, { hifi: false });
            br = fresh.bitrate;
            ({ sound } = await Audio.Sound.createAsync(
              { uri: fresh.url, overrideFileExtensionAndroid: "webm" },
              {
                shouldPlay: true,
                progressUpdateIntervalMillis: 500,
                androidImplementation: "MediaPlayer",
              },
              onStatus
            ));
          }
        }
      }

      setBitrate(br);
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(onStatus);
      activateKeepAwakeAsync("audiovibe-playback").catch(() => {});
      addHistory(track).catch(() => {});
    } catch (e) {
      setError(e?.message || "Lecture impossible");
      setIsPlaying(false);
    } finally {
      setLoading(false);
    }
  };

  const playIndex = async (i) => {
    const q = queueRef.current;
    if (!q[i]) return;
    setIndex(i);
    setCurrent(q[i]);
    await loadTrack(q[i]);
  };

  const playTrack = async (track, list) => {
    const q = list && list.length ? list : [track];
    queueRef.current = q;
    setQueue(q);
    const i = Math.max(
      0,
      q.findIndex((t) => t.id === track.id)
    );
    await playIndex(i);
  };

  const toggle = async () => {
    const s = soundRef.current;
    if (!s) return;
    const st = await s.getStatusAsync();
    if (st.isPlaying) {
      await s.pauseAsync();
      deactivateKeepAwake("audiovibe-playback").catch(() => {});
    } else {
      await s.playAsync();
      activateKeepAwakeAsync("audiovibe-playback").catch(() => {});
    }
  };

  const next = () => {
    const q = queueRef.current;
    if (index < q.length - 1) playIndex(index + 1);
    else if (repeat === "all" && q.length) playIndex(0);
  };

  const prev = async () => {
    if (position > 4000 && soundRef.current) {
      await soundRef.current.setPositionAsync(0);
      return;
    }
    if (index > 0) playIndex(index - 1);
  };

  const seek = async (ms) => {
    await soundRef.current?.setPositionAsync(ms).catch(() => {});
  };

  const cycleRepeat = () =>
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));

  const stop = async () => {
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    setCurrent(null);
    setIsPlaying(false);
    deactivateKeepAwake("audiovibe-playback").catch(() => {});
  };

  return (
    <Ctx.Provider
      value={{
        current,
        queue,
        index,
        isPlaying,
        loading,
        position,
        duration,
        repeat,
        error,
        bitrate,
        expanded,
        setExpanded,
        playTrack,
        toggle,
        next,
        prev,
        seek,
        cycleRepeat,
        stop,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
