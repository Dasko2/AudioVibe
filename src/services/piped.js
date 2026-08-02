/**
 * Compatibilité : l'application importait auparavant les instances Piped.
 * L'extraction est désormais 100 % locale (voir ./youtube.js) — plus aucune
 * instance publique externe. Ce module ne fait que ré-exporter la nouvelle API.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  CLIENTS,
  fetchPlaylist,
  getAudioStream,
  getHlsStream,
  searchTracks,
  setPreferredClient,
  trending,
  estimateSizeMb,
  streamHeaders,
} from "./youtube";

const CACHE_KEY = "audiovibe.client";

/** Liste des moteurs d'extraction locaux (affichés dans les paramètres). */
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
  fetchPlaylist,
  getAudioStream,
  getHlsStream,
  searchTracks,
  trending,
  estimateSizeMb,
  streamHeaders,
};
