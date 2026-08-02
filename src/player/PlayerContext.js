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
import { getAudioStream, getDashStream, getHlsStream } from "../services/piped";
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
   * Quand createAsync réussit mais qu'ExoPlayer échoue lors du premier
   * buffering (403, IO…), expo-av appelle onStatus avec
   * { isLoaded: false, error: "..." }. Ce ref stocke la prochaine stratégie
   * à déclencher automatiquement dans ce cas.
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
   * Tente de charger `source` via expo-av.
   * - Enregistre `nextFallback` AVANT createAsync pour que onStatus puisse
   *   le déclencher si ExoPlayer échoue de façon asynchrone.
   * - Si createAsync lève de façon synchrone, retire le fallback et relance.
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

    try {
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;

      // ── Fichier téléchargé localement ────────────────────────────────────
      const offline = await getDownload(track.id);
      if (offline?.uri) {
        const sound = await trySource({ uri: offline.uri }, {}, null);
        finalize(sound, 0);
        return;
      }

      // ── Récupération des URLs InnerTube ──────────────────────────────────
      // Pas de probe fetch() : fausse confiance sur Android (l'UA est ignoré
      // par fetch mais ExoPlayer l'envoie → 403).
      const stream = await getAudioStream(track.id, { hifi: !settings.dataSaver });

      /**
       * Chaîne de fallback (du plus fiable au moins fiable sur Android) :
       *
       *  1. HLS  (m3u8 iOS/TESTSUITE — segments non liés à l'UA)
       *  2. DASH (mpd — idem, ExoPlayer natif)
       *  3. WebM/Opus + headers + overrideExt:"webm"
       *  4. AAC/MP4 + headers  (format plus universel Android)
       *  5. Flux combiné vidéo+audio MP4 (ExoPlayer extrait l'audio)
       *  6. WebM sans overrideExt (ExoPlayer détecte via Content-Type)
       *  7. Erreur finale propre
       *
       * Sur iOS : démarre à l'étape 3 (HLS/DASH gérés différemment par AVPlayer).
       */

      const { url: urlWebm, urlAac, urlCombined, headers, dashManifestUrl } = stream;

      // ── helper de finalisation ───────────────────────────────────────────
      const finalize = (s, br) => {
        setBitrate(br || 0);
        soundRef.current = s;
        s.setOnPlaybackStatusUpdate(onStatus);
        activateKeepAwakeAsync("audiovibe-playback").catch(() => {});
        addHistory(track).catch(() => {});
        setLoading(false);
      };

      // ── Fallbacks (définition de la fin vers le début) ───────────────────

      // Étape 7 : échec total
      const step7 = (_err) => {
        setError("Lecture impossible pour ce titre");
        setIsPlaying(false);
        setLoading(false);
      };

      // Étape 6 : WebM sans overrideFileExtensionAndroid
      const step6 = async (_err) => {
        if (!urlWebm) return step7(_err);
        try {
          const s = await trySource({ uri: urlWebm, headers }, {}, step7);
          finalize(s, stream.bitrate);
        } catch {
          step7();
        }
      };

      // Étape 5 : flux combiné vidéo+audio MP4
      const step5 = async (_err) => {
        if (!urlCombined) return step6(_err);
        try {
          const s = await trySource(
            { uri: urlCombined, headers, overrideFileExtensionAndroid: "mp4" },
            {},
            step6
          );
          finalize(s, 0);
        } catch {
          return step6(_err);
        }
      };

      // Étape 4 : AAC/MP4 audio-only + headers
      const step4 = async (_err) => {
        if (!urlAac) return step5(_err);
        try {
          const s = await trySource({ uri: urlAac, headers }, {}, step5);
          finalize(s, 0);
        } catch {
          return step5(_err);
        }
      };

      // Étape 3 : WebM/Opus + headers + overrideFileExtensionAndroid:"webm"
      const step3 = async (_err) => {
        if (!urlWebm) return step4(_err);
        try {
          const s = await trySource(
            { uri: urlWebm, headers, overrideFileExtensionAndroid: "webm" },
            {},
            step4
          );
          finalize(s, stream.bitrate);
        } catch {
          return step4(_err);
        }
      };

      // Étape 2 : DASH manifest
      const step2 = async (_err) => {
        // Utiliser le dashManifestUrl déjà récupéré si disponible,
        // sinon appeler getDashStream.
        let dashUrl = dashManifestUrl;
        if (!dashUrl) {
          try {
            const dash = await getDashStream(track.id);
            dashUrl = dash.url;
          } catch {
            dashUrl = null;
          }
        }
        if (!dashUrl) return step3(_err);
        try {
          const s = await trySource(
            { uri: dashUrl, overrideFileExtensionAndroid: "mpd" },
            {},
            step3
          );
          finalize(s, 0);
        } catch {
          return step3(_err);
        }
      };

      // Étape 1 : HLS manifest (Android en premier, iOS via AVPlayer natif)
      const step1 = async () => {
        let hlsUrl = null;
        try {
          const hls = await getHlsStream(track.id);
          hlsUrl = hls.url;
        } catch {
          hlsUrl = null;
        }
        if (!hlsUrl) return step2(null);
        try {
          const s = await trySource(
            { uri: hlsUrl, overrideFileExtensionAndroid: "m3u8" },
            {},
            step2
          );
          finalize(s, 0);
        } catch {
          return step2(null);
        }
      };

      if (Platform.OS === "android") {
        // Android : HLS → DASH → WebM → AAC → Combined → WebM(no override)
        await step1();
      } else {
        // iOS : WebM → AAC → HLS → DASH → Combined → erreur
        // (AVPlayer gère mieux les URL directes que les manifestes sur certaines versions)
        try {
          const s = await trySource({ uri: urlWebm, headers }, {}, step4);
          finalize(s, stream.bitrate);
        } catch {
          await step4(null);
        }
      }
    } catch (e) {
      setError(e?.message || "Lecture impossible");
      setIsPlaying(false);
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  // ── Définir finalize à l'extérieur pour les fichiers offline ────────────
  const finalize = (s, br) => {
    setBitrate(br || 0);
    soundRef.current = s;
    s.setOnPlaybackStatusUpdate(onStatus);
    activateKeepAwakeAsync("audiovibe-playback").catch(() => {});
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
