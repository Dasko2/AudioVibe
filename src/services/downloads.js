import * as FileSystem from "expo-file-system";

import { addDownload, getDownload, removeDownload } from "../data/db";
import { getAudioStream } from "./piped";

const DIR = FileSystem.documentDirectory + "audiovibe/";

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export async function downloadTrack(track, { hifi = false } = {}) {
  await ensureDir();
  const existing = await getDownload(track.id);
  if (existing?.uri) return existing;

  const stream = await getAudioStream(track.id, { hifi });
  const target = `${DIR}${track.id}.webm`;
  const res = await FileSystem.downloadAsync(stream.url, target, {
    headers: stream.headers,
  });
  const info = await FileSystem.getInfoAsync(res.uri);
  await addDownload(track, res.uri, info.size || 0);
  return { uri: res.uri, bytes: info.size || 0 };
}

export async function deleteDownload(videoId) {
  const row = await getDownload(videoId);
  if (row?.uri) await FileSystem.deleteAsync(row.uri, { idempotent: true });
  await removeDownload(videoId);
}

export const mb = (bytes = 0) => (bytes / 1024 / 1024).toFixed(1) + " Mo";
