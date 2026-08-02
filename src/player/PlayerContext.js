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
import { getAudioStream } from "../services/piped";
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
      if (!status?.isLoaded) return;
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

      let uri;
      let br = 0;
      // Les URL googlevideo sont liées au client qui les a demandées : sans
      // ces en-têtes, ExoPlayer reçoit un 403 (InvalidResponseCodeException).
      let headers;
      const offline = await getDownload(track.id);
      if (offline?.uri) {
        uri = offline.uri;
      } else {
        const stream = await getAudioStream(track.id, {
          hifi: !settings.dataSaver,
        });
        uri = stream.url;
        br = stream.bitrate;
        headers = stream.headers;
      }
      const source = headers
        ? { uri, headers, overrideFileExtensionAndroid: "webm" }
        : { uri };
      let sound;
      try {
        ({ sound } = await Audio.Sound.createAsync(
          source,
          { shouldPlay: true, progressUpdateIntervalMillis: 500 },
          onStatus
        ));
      } catch (firstError) {
        // ExoPlayer et fetch n'utilisent pas la même pile HTTP. Sur certains
        // appareils, googlevideo accepte le probe puis refuse ExoPlayer. Une
        // URL fraîche lue par MediaPlayer évite ce faux positif sans proxy.
        if (offline?.uri || Platform.OS !== "android") throw firstError;
        const fresh = await getAudioStream(track.id, {
          hifi: !settings.dataSaver,
        });
        br = fresh.bitrate;
        headers = fresh.headers;
        uri = fresh.url;
        ({ sound } = await Audio.Sound.createAsync(
          {
            uri,
            headers,
            overrideFileExtensionAndroid: "webm",
          },
          {
            shouldPlay: true,
            progressUpdateIntervalMillis: 500,
            androidImplementation: "MediaPlayer",
          },
          onStatus
        ));
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
