/**
 * Zero-API-key audio extraction through public Piped instances.
 * No token, no Google API, no self-hosted backend.
 * Instances are tried in order with a short timeout and cached on success.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.drgns.space",
];

const CACHE_KEY = "audiovibe.instance";
let preferred = null;

export async function loadPreferredInstance() {
  try {
    preferred = await AsyncStorage.getItem(CACHE_KEY);
  } catch {
    preferred = null;
  }
  return preferred;
}

export async function setPreferredInstance(url) {
  preferred = url;
  try {
    await AsyncStorage.setItem(CACHE_KEY, url);
  } catch {}
}

function ordered() {
  const list = INSTANCES.filter((i) => i !== preferred);
  return preferred ? [preferred, ...list] : list;
}

async function fetchTimeout(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function anyInstance(path) {
  let lastErr;
  for (const base of ordered()) {
    try {
      const data = await fetchTimeout(base + path);
      await setPreferredInstance(base);
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    "Aucune instance publique disponible (" + (lastErr?.message || "réseau") + ")"
  );
}

const idFromUrl = (u = "") => {
  const m = String(u).match(/(?:watch\?v=|\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};

const mapItem = (v) => ({
  id: idFromUrl(v.url) || v.id,
  title: v.title || "Sans titre",
  author: v.uploaderName || v.uploader || "",
  thumbnail: v.thumbnail || v.thumbnailUrl || "",
  duration: v.duration ?? 0,
});

export async function searchTracks(query) {
  const data = await anyInstance(
    `/search?q=${encodeURIComponent(query)}&filter=music_songs`
  );
  const items = (data?.items || []).filter((v) => v.type !== "channel");
  const mapped = items.map(mapItem).filter((v) => v.id);
  if (mapped.length) return mapped;
  const fb = await anyInstance(
    `/search?q=${encodeURIComponent(query)}&filter=videos`
  );
  return (fb?.items || []).map(mapItem).filter((v) => v.id);
}

export async function trending(region = "FR") {
  const data = await anyInstance(`/trending?region=${region}`);
  return (data || []).map(mapItem).filter((v) => v.id);
}

/** Accepts a full YouTube playlist URL or a raw playlist id. */
export async function fetchPlaylist(urlOrId) {
  const m = String(urlOrId).match(/list=([A-Za-z0-9_-]+)/);
  const id = m ? m[1] : String(urlOrId).trim();
  const data = await anyInstance(`/playlists/${encodeURIComponent(id)}`);
  return {
    name: data?.name || "Playlist importée",
    items: (data?.relatedStreams || []).map(mapItem).filter((v) => v.id),
  };
}

/**
 * Ultra data-saver: pick the LOWEST bitrate audio-only stream (Opus/WebM).
 * ~64-96 kbps => roughly 1.5-2.5 MB for a 3-4 minute track.
 */
export async function getAudioStream(videoId, { hifi = false } = {}) {
  const data = await anyInstance(`/streams/${videoId}`);
  const audio = (data?.audioStreams || []).filter((s) => s.url);
  if (!audio.length) throw new Error("Aucun flux audio disponible");

  const score = (s) => s.bitrate || 999999;
  const opus = audio.filter((s) => /opus|webm/i.test(s.codec || s.mimeType || ""));
  const pool = opus.length ? opus : audio;
  const sorted = [...pool].sort((a, b) => score(a) - score(b));

  // data-saver: lowest; hifi: best under 160kbps
  const chosen = hifi
    ? sorted[sorted.length - 1]
    : sorted.find((s) => (s.bitrate || 0) >= 48000) || sorted[0];

  return {
    url: chosen.url,
    bitrate: chosen.bitrate || 0,
    mime: chosen.mimeType || "audio/webm",
    title: data?.title,
    author: data?.uploader,
    thumbnail: data?.thumbnailUrl,
    duration: data?.duration ?? 0,
    videoUrl: (data?.videoStreams || []).find((v) => v.url)?.url || null,
  };
}

export const estimateSizeMb = (bitrate, durationSec) =>
  ((bitrate || 64000) / 8) * (durationSec || 0) / 1024 / 1024;
