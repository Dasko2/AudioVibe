/**
 * AudioVibe v1.0.7 — PlayerContext
 *
 * Extraction via Cobalt → Piped → InnerTube (sans hébergement, sans clé API).
 *
 * Chaîne de fallback par source :
 *   1. Fichier local (téléchargé)
 *   2. HLS manifest  (le plus robuste sur Android)
 *   3. urlBest       (meilleure URL directe retournée)
 *   4. urlWebm       (Opus/WebM + overrideFileExtensionAndroid)
 *   5. urlM4a        (AAC/MP4, format universel Android)
 *   6. Erreur finale
 */

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

import { addHistory, getDownload } from "../data/db";
import { getAudioStream } from "../services/piped";

const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

export function PlayerProvider({ children }) {
  const soundRef = useRef(null);
  const queueRef = useRef([]);

  const [current, setCurrent]   = useState(null);
  const [queue, setQueue]       = useState([]);
  const [index, setIndex]       = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeat, setRepeat]     = useState("off"); // off | one | all
  const [error, setError]       = useState(null);
  const [bitrate, setBitrate]   = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      playThroughEarpieceAndroid: false,
    }).catch((e) => console.warn("[audio mode]", e?.message));
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, []);

  /**
   * loadFallbackRef — gère les erreurs async d'ExoPlayer.
   * Si createAsync réussit mais qu'ExoPlayer échoue pendant le buffering
   * (403, IO…), expo-av appelle onStatus({ isLoaded: false, error }).
   * Ce ref stocke la prochaine stratégie à déclencher automatiquement.
   */
  const loadFallbackRef = useRef(null);

  const onStatus = useCallback(
    (status) => {
      if (!status?.isLoaded) {
        if (status?.error) {
          const fallback = loadFallbackRef.current;
          loadFallbackRef.current = null;
          if (fallback) {
            fallback(status.error);
          } else {
            setError("Lecture impossible pour ce titre");
            setIsPlaying(false);
            setLoading(false);
          }
        }
        return;
      }
      loadFallbackRef.current = null;
      setPosition(status.positionMillis || 0);
      setDuration(status.durationMillis || 0);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish && !status.isLooping) handleFinish();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repeat, index]
  );

  const handleFinish = () => {
    const q = queueRef.current;
    if (repeat === "one") { soundRef.current?.replayAsync().catch(() => {}); return; }
    if (index < q.length - 1) return playIndex(index + 1);
    if (repeat === "all" && q.length) return playIndex(0);
    setIsPlaying(false);
  };

  /**
   * trySource — charge une URL via expo-av.
   * Enregistre nextFallback AVANT createAsync pour que onStatus puisse
   * le déclencher si ExoPlayer échoue de façon asynchrone.
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

    const finalize = (s, br = 0) => {
      setBitrate(br);
      soundRef.current = s;
      s.setOnPlaybackStatusUpdate(onStatus);
      activateKeepAwakeAsync("audiovibe-playback").catch(() => {});
      addHistory(track).catch(() => {});
      setLoading(false);
    };

    try {
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;

      // ── 0. Fichier local ─────────────────────────────────────────────────
      const offline = await getDownload(track.id);
      if (offline?.uri) {
        const sound = await trySource({ uri: offline.uri }, {}, null);
        finalize(sound, 0);
        return;
      }

      // ── 1. Extraction distante (Cobalt → Piped → InnerTube) ─────────────
      let stream;
      try {
        stream = await getAudioStream(track.id);
      } catch (fetchErr) {
        setError(`Impossible de récupérer ce titre (${fetchErr.message})`);
        setLoading(false);
        return;
      }

      const { hlsUrl, urlBest, urlWebm, urlM4a } = stream;

      // ── Chaîne de fallback ───────────────────────────────────────────────

      // Étape 5 : erreur finale
      const step5 = (_err) => {
        setError("Lecture impossible pour ce titre");
        setIsPlaying(false);
        setLoading(false);
      };

      // Étape 4 : M4A/AAC direct
      const step4 = async (_err) => {
        if (!urlM4a || urlM4a === urlBest) return step5(_err);
        try {
          const s = await trySource({ uri: urlM4a }, {}, step5);
          finalize(s, 0);
        } catch { step5(_err); }
      };

      // Étape 3 : WebM/Opus + overrideFileExtensionAndroid
      const step3 = async (_err) => {
        if (!urlWebm || urlWebm === urlBest) return step4(_err);
        try {
          const s = await trySource(
            { uri: urlWebm, overrideFileExtensionAndroid: "webm" },
            {},
            step4
          );
          finalize(s, 0);
        } catch { return step4(_err); }
      };

      // Étape 2 : meilleure URL directe (Cobalt renvoie souvent un tunnel audio)
      const step2 = async (_err) => {
        if (!urlBest) return step3(_err);
        // Cobalt renvoie souvent une URL opaque sans extension → forcer mp4
        // Piped/InnerTube : deviner à partir du contenu
        const ext = urlBest.includes(".webm") ? "webm" : "mp4";
        try {
          const s = await trySource(
            { uri: urlBest, overrideFileExtensionAndroid: ext },
            {},
            step3
          );
          finalize(s, 0);
        } catch { return step3(_err); }
      };

      // Étape 1 : HLS manifest (plus robuste — segments courts, pas de header UA)
      const step1 = async () => {
        if (!hlsUrl) return step2(null);
        try {
          const s = await trySource(
            { uri: hlsUrl, overrideFileExtensionAndroid: "m3u8" },
            {},
            step2
          );
          finalize(s, 0);
        } catch { return step2(null); }
      };

      await step1();

    } catch (e) {
      console.error("[loadTrack]", e);
      setError("Erreur inattendue lors de la lecture");
      setLoading(false);
    }
  };

  const playIndex = async (i) => {
    const q = queueRef.current;
    if (i < 0 || i >= q.length) return;
    setIndex(i);
    setCurrent(q[i]);
    await loadTrack(q[i]);
  };

  const playTrack = async (track, newQueue = null) => {
    if (newQueue) {
      queueRef.current = newQueue;
      setQueue(newQueue);
      const i = newQueue.findIndex((t) => t.id === track.id);
      setIndex(i >= 0 ? i : 0);
    }
    setCurrent(track);
    await loadTrack(track);
  };

  const toggle = async () => {
    if (!soundRef.current) return;
    if (isPlaying) await soundRef.current.pauseAsync().catch(() => {});
    else           await soundRef.current.playAsync().catch(() => {});
  };

  const next = async () => {
    const q = queueRef.current;
    if (index < q.length - 1) return playIndex(index + 1);
    if (repeat === "all") return playIndex(0);
  };

  const prev = async () => {
    if (position > 4000 && soundRef.current) {
      await soundRef.current.setPositionAsync(0);
      return;
    }
    if (index > 0) playIndex(index - 1);
  };

  const seek  = async (ms) => { await soundRef.current?.setPositionAsync(ms).catch(() => {}); };
  const cycleRepeat = () => setRepeat((r) => r === "off" ? "all" : r === "all" ? "one" : "off");

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
        current, queue, index,
        isPlaying, loading,
        position, duration,
        repeat, error, bitrate,
        expanded, setExpanded,
        playTrack, toggle,
        next, prev, seek,
        cycleRepeat, stop,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
