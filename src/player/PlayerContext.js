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

  /**
   * loadFallbackRef — gestion des erreurs async d'ExoPlayer.
   *
   * createAsync peut résoudre avec succès (objet Sound créé) puis ExoPlayer
   * échoue asynchronement lors du premier buffering (403, -1005…). Dans ce
   * cas expo-av appelle onStatus avec { isLoaded: false, error: "..." }.
   *
   * Ce ref stocke la prochaine stratégie de fallback à déclencher si onStatus
   * reçoit une telle erreur. Il est vidé dès qu'une stratégie réussit.
   */
  const loadFallbackRef = useRef(null);

  const onStatus = useCallback(
    (status) => {
      if (!status?.isLoaded) {
        if (status?.error) {
          // Erreur asynchrone (ex : ExoPlayer 403, -1005 IO error…).
          // Si un fallback est enregistré, on l'exécute ; sinon, on affiche.
          const fallback = loadFallbackRef.current;
          loadFallbackRef.current = null;
          if (fallback) {
            fallback(status.error);
          } else {
            setError(status.error);
            setIsPlaying(false);
          }
        }
        return;
      }
      // Succès : plus besoin de fallback.
      loadFallbackRef.current = null;
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

  /**
   * Tente de créer un Sound depuis `source`.
   * Si createAsync lève synchronement → throw (fallback chaîné appelant).
   * Si ExoPlayer échoue de façon async → loadFallbackRef est appelé.
   *
   * On enregistre `nextFallback` AVANT createAsync de sorte que onStatus
   * puisse le déclencher si nécessaire. Si createAsync lève lui-même,
   * on retire le fallback (le catch de l'appelant prend la main).
   */
  const trySource = useCallback(
    async (source, options, nextFallback) => {
      loadFallbackRef.current = nextFallback || null;
      let sound;
      try {
        ({ sound } = await Audio.Sound.createAsync(
          source,
          { shouldPlay: true, progressUpdateIntervalMillis: 500, ...options },
          onStatus
        ));
      } catch (e) {
        // Erreur synchrone : le fallback async n'est plus utile.
        loadFallbackRef.current = null;
        throw e;
      }
      return sound;
    },
    [onStatus]
  );

  const loadTrack = async (track) => {
    setLoading(true);
    setError(null);
    loadFallbackRef.current = null;

    try {
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;

      // ── Fichier téléchargé ────────────────────────────────────────────────
      const offline = await getDownload(track.id);
      if (offline?.uri) {
        const sound = await trySource({ uri: offline.uri }, {}, null);
        setBitrate(0);
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate(onStatus);
        activateKeepAwakeAsync("audiovibe-playback").catch(() => {});
        addHistory(track).catch(() => {});
        return;
      }

      // ── Récupération des URLs (sans probe — le probe fetch() ignorait l'UA
      //    sur Android, donnant une fausse confiance ; ExoPlayer décide seul).
      const stream = await getAudioStream(track.id, { hifi: !settings.dataSaver });
      const { url: urlWebm, urlAac, headers } = stream;

      // ── Stratégie 1 (Android) : HLS via client iOS ────────────────────────
      // m3u8 non lié à l'User-Agent → ExoPlayer le lit sans 403 ni -1005.
      let sound = null;
      let br = 0;

      const tryHls = async (nextFn) => {
        try {
          const hls = await getHlsStream(track.id);
          return await trySource(
            { uri: hls.url, overrideFileExtensionAndroid: "m3u8" },
            {},
            nextFn
          );
        } catch {
          return null;
        }
      };

      // ── Définir la chaîne de fallback async (de la fin vers le début) ─────
      //
      // Chaîne (Android) :
      //   HLS → WebM+headers → AAC+headers → WebM sans overrideExt → erreur
      //
      // Chaîne (iOS) :
      //   WebM+headers → AAC+headers → WebM sans overrideExt → erreur

      // Fallback final commun : message clair si tout a échoué.
      const fallbackFinal = (errMsg) => {
        setError("Lecture impossible pour ce titre");
        setIsPlaying(false);
        setLoading(false);
      };

      // Fallback 4 : WebM sans overrideFileExtensionAndroid (laisse ExoPlayer
      // détecter le format depuis le Content-Type de la réponse).
      const fallback4 = async (_err) => {
        try {
          sound = await trySource(
            { uri: urlWebm, headers },
            {},
            fallbackFinal
          );
          finalize(sound, stream.bitrate);
        } catch {
          fallbackFinal();
        }
      };

      // Fallback 3 : AAC/MP4 + ExoPlayer + headers (format plus universel
      // sur Android, pas besoin de overrideFileExtensionAndroid pour MP4).
      const fallback3 = async (_err) => {
        if (!urlAac) return fallback4(_err);
        try {
          sound = await trySource(
            { uri: urlAac, headers },
            {},
            fallback4
          );
          finalize(sound, 0);
        } catch {
          return fallback4(_err);
        }
      };

      // Fallback 2 : WebM + ExoPlayer + headers + overrideFileExtensionAndroid
      const fallback2 = async (_err) => {
        try {
          sound = await trySource(
            { uri: urlWebm, headers, overrideFileExtensionAndroid: "webm" },
            {},
            fallback3
          );
          finalize(sound, stream.bitrate);
        } catch {
          return fallback3(_err);
        }
      };

      // Fallback 1 (iOS seulement, cas où la stratégie primaire WebM échoue) :
      // AAC/MP4 direct.
      const fallbackIosAac = async (_err) => {
        if (!urlAac) return fallback4(_err);
        try {
          sound = await trySource(
            { uri: urlAac, headers },
            {},
            fallback4
          );
          finalize(sound, 0);
        } catch {
          return fallback4(_err);
        }
      };

      // Helper d'enregistrement final (appelé quand un source réussit).
      const finalize = (s, bitrateVal) => {
        setBitrate(bitrateVal || 0);
        soundRef.current = s;
        s.setOnPlaybackStatusUpdate(onStatus);
        activateKeepAwakeAsync("audiovibe-playback").catch(() => {});
        addHistory(track).catch(() => {});
        setLoading(false);
      };

      if (Platform.OS === "android") {
        // ── Android : HLS en premier ──────────────────────────────────────
        sound = await tryHls(fallback2);
        if (sound) {
          finalize(sound, 0);
          return;
        }
        // HLS a échoué synchronement → tenter WebM + headers
        try {
          sound = await trySource(
            { uri: urlWebm, headers, overrideFileExtensionAndroid: "webm" },
            {},
            fallback3
          );
          finalize(sound, stream.bitrate);
        } catch {
          // createAsync synchrone échoué → enchaîner fallback3
          await fallback3(null);
        }
      } else {
        // ── iOS : WebM + headers en premier ──────────────────────────────
        try {
          sound = await trySource(
            { uri: urlWebm, headers },
            {},
            fallbackIosAac
          );
          finalize(sound, stream.bitrate);
        } catch {
          await fallbackIosAac(null);
        }
      }
    } catch (e) {
      setError(e?.message || "Lecture impossible");
      setIsPlaying(false);
      setLoading(false);
    } finally {
      // setLoading(false) est appelé dans finalize() ou ici en cas d'erreur.
      // On s'assure qu'il est toujours false à la sortie.
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
