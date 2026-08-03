/**
 * AudioVibe v1.0.7 — ré-exporte youtube.js (Cobalt → Piped → InnerTube)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  CLIENTS,
  estimateSizeMb,
  fetchPlaylist,
  getAudioStream,
  getDashStream,
  getHlsStream,
  searchTracks,
  setPreferredClient,
  streamHeaders,
  trending,
} from "./youtube";

const CACHE_KEY = "audiovibe.client";

export const INSTANCES = CLIENTS.map((c) => c.id);
export const CLIENT_LABELS = Object.fromEntries(CLIENTS.map((c) => [c.id, c.label]));

export async function loadPreferredInstance() {
  try {
    const saved = await AsyncStorage.getItem(CACHE_KEY);
    if (saved) setPreferredClient(saved);
    return saved;
  } catch {
    return null;
  }
}

export async function setPreferredInstance(id) {
  setPreferredClient(id);
  try {
    await AsyncStorage.setItem(CACHE_KEY, id);
  } catch {}
}

export {
  estimateSizeMb,
  fetchPlaylist,
  getAudioStream,
  getDashStream,
  getHlsStream,
  searchTracks,
  streamHeaders,
  trending,
};
