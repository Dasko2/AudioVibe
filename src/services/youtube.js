/**
 * AudioVibe v1.0.7 — extraction audio sans hébergement, sans clé API
 *
 * Stratégie :
 *   1. Cobalt.tools  — API publique gratuite, bien maintenue
 *   2. Piped         — plusieurs instances publiques en fallback
 *   3. InnerTube     — extraction locale de dernier recours (ANDROID_TESTSUITE)
 */

/* ─── Cobalt ─────────────────────────────────────────────────── */

const COBALT_API = "https://api.cobalt.tools";
const COBALT_TIMEOUT = 12_000;

async function cobaltStream(videoId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COBALT_TIMEOUT);
  try {
    const res = await fetch(COBALT_API, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        downloadMode: "audio",
        audioFormat: "best",
        filenameStyle: "basic",
      }),
    });
    if (!res.ok) throw new Error(`Cobalt HTTP ${res.status}`);
    const data = await res.json();
    // status: "stream" | "redirect" | "tunnel" | "error" | "picker"
    if (data.status === "error") throw new Error(data.error?.code || "Cobalt error");
    const url = data.url;
    if (!url) throw new Error("Cobalt: pas d'URL");
    return { urlBest: url, urlWebm: null, urlM4a: null, hlsUrl: null, from: "cobalt" };
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Piped ──────────────────────────────────────────────────── */

/** Instances Piped publiques, essayées dans l'ordre */
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.tokhmi.xyz",
  "https://api.piped.projectsegfau.lt",
  "https://piped-api.garudalinux.org",
  "https://pa.il.ax",
];
const PIPED_TIMEOUT = 12_000;

async function pipedStream(videoId) {
  let lastErr;
  for (const base of PIPED_INSTANCES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PIPED_TIMEOUT);
    try {
      const res = await fetch(`${base}/streams/${videoId}`, { signal: ctrl.signal });
      if (!res.ok) { lastErr = new Error(`Piped ${base} HTTP ${res.status}`); continue; }
      const data = await res.json();

      /** audioStreams : [{ url, quality, mimeType, codec, bitrate, contentLength }] */
      const streams = (data.audioStreams || []).filter((s) => s.url);
      if (!streams.length) { lastErr = new Error("Piped: aucun flux audio"); continue; }

      // Préférer opus/webm, sinon m4a
      const sortByBitrate = (arr) => [...arr].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const webmStreams = sortByBitrate(streams.filter((s) => s.mimeType?.includes("webm") || s.codec?.includes("opus")));
      const m4aStreams  = sortByBitrate(streams.filter((s) => s.mimeType?.includes("mp4")  || s.codec?.includes("mp4a")));
      const bestStream  = sortByBitrate(streams)[0];

      return {
        urlBest: bestStream?.url  || null,
        urlWebm: webmStreams[0]?.url || null,
        urlM4a:  m4aStreams[0]?.url  || null,
        hlsUrl:  data.hls            || null,
        from: "piped",
      };
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("Piped: toutes les instances ont échoué");
}

/* ─── InnerTube (dernier recours) ────────────────────────────── */

const INNERTUBE_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const BASE = "https://www.youtube.com/youtubei/v1";

const TESTSUITE_CLIENT = {
  id: "ANDROID_TESTSUITE",
  context: { clientName: "ANDROID_TESTSUITE", clientVersion: "1.9", androidSdkVersion: 34, osName: "Android", osVersion: "14", hl: "fr" },
  ua: "com.google.android.youtube/1.9 (Linux; U; Android 14) gzip",
};

async function innertubeStream(videoId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${BASE}/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "User-Agent": TESTSUITE_CLIENT.ua, "X-YouTube-Client-Name": "30", "X-YouTube-Client-Version": "1.9" },
      body: JSON.stringify({
        context: { client: TESTSUITE_CLIENT.context },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    if (!res.ok) throw new Error(`InnerTube HTTP ${res.status}`);
    const data = await res.json();

    const formats = [...(data?.streamingData?.adaptiveFormats || []), ...(data?.streamingData?.formats || [])];
    const audioOnly = formats.filter((f) => f.url && f.mimeType?.startsWith("audio/"));

    const webm = audioOnly.filter((f) => f.mimeType?.includes("webm")).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    const m4a  = audioOnly.filter((f) => f.mimeType?.includes("mp4")).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    const best = audioOnly.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!best) throw new Error("InnerTube: aucun flux direct (signatureCipher uniquement)");

    return {
      urlBest: best?.url  || null,
      urlWebm: webm?.url  || null,
      urlM4a:  m4a?.url   || null,
      hlsUrl:  data?.streamingData?.hlsManifestUrl || null,
      from: "innertube",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ─── API publique principale ────────────────────────────────── */

/**
 * getAudioStream — essaie Cobalt → Piped → InnerTube
 * Retourne : { urlBest, urlWebm, urlM4a, hlsUrl, from }
 */
export async function getAudioStream(videoId) {
  const errors = [];

  // 1. Cobalt
  try { return await cobaltStream(videoId); }
  catch (e) { errors.push(`cobalt: ${e.message}`); }

  // 2. Piped (plusieurs instances)
  try { return await pipedStream(videoId); }
  catch (e) { errors.push(`piped: ${e.message}`); }

  // 3. InnerTube local (dernier recours)
  try { return await innertubeStream(videoId); }
  catch (e) { errors.push(`innertube: ${e.message}`); }

  throw new Error(`Toutes les sources ont échoué :\n${errors.join("\n")}`);
}

/** Alias HLS — tente d'abord Piped (retourne toujours hlsUrl) puis Cobalt */
export async function getHlsStream(videoId) {
  // Piped a souvent un manifest HLS
  try {
    const s = await pipedStream(videoId);
    if (s.hlsUrl) return { url: s.hlsUrl, hls: true };
  } catch {}
  throw new Error("Aucun flux HLS disponible");
}

/** Non utilisé mais gardé pour compatibilité d'import */
export async function getDashStream() {
  throw new Error("DASH non supporté dans ce mode");
}

/* ─── Recherche & tendances via Piped ───────────────────────── */

async function pipedFetch(path) {
  let lastErr;
  for (const base of PIPED_INSTANCES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${base}${path}`, { signal: ctrl.signal });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      return await res.json();
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("Piped: toutes les instances ont échoué");
}

export async function searchTracks(query) {
  const data = await pipedFetch(`/search?q=${encodeURIComponent(query)}&filter=music_songs`);
  return (data.items || []).filter((i) => i.type === "stream").map(normalizePiped);
}

export async function trending() {
  const data = await pipedFetch("/trending?region=FR");
  return (data || []).filter((i) => i.type === "stream").slice(0, 30).map(normalizePiped);
}

function normalizePiped(item) {
  const thumb = item.thumbnail || item.thumbnailUrl || "";
  return {
    id:        (item.url || "").replace("/watch?v=", "") || item.id || "",
    title:     item.title || "Titre inconnu",
    artist:    item.uploaderName || item.uploader || "",
    duration:  item.duration || 0,
    thumbnail: thumb,
  };
}

/* ─── Utilitaires ────────────────────────────────────────────── */

export function estimateSizeMb(durationSec) {
  return Math.round((durationSec * 128) / 8 / 1024 * 10) / 10;
}
export const streamHeaders = {};
export const CLIENTS = [{ id: "AUTO", label: "Cobalt → Piped → InnerTube" }];
export function setPreferredClient() {}
export function getPreferredClient() { return "AUTO"; }
export function fetchPlaylist() { return Promise.reject(new Error("Non supporté")); }
