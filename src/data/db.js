/**
 * Local SQLite storage. No remote server, no auth, no API key.
 * Every function is defensive: if the DB fails to open, the app keeps
 * working in memory instead of blocking the UI.
 */
import * as SQLite from "expo-sqlite";

let db = null;
let ready = false;
let initError = null;

const memory = { favorites: [], history: [], playlists: [], items: [] };

export async function initDb() {
  try {
    db = await SQLite.openDatabaseAsync("audiovibe.db");
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY NOT NULL,
        name TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS favorites (
        video_id TEXT PRIMARY KEY NOT NULL,
        title TEXT, author TEXT, thumbnail TEXT, duration INTEGER,
        added_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT, title TEXT, author TEXT, thumbnail TEXT,
        duration INTEGER, played_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS playlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL,
        video_id TEXT, title TEXT, author TEXT, thumbnail TEXT,
        duration INTEGER, position INTEGER
      );
      CREATE TABLE IF NOT EXISTS downloads (
        video_id TEXT PRIMARY KEY NOT NULL,
        title TEXT, author TEXT, thumbnail TEXT, duration INTEGER,
        uri TEXT, bytes INTEGER, created_at INTEGER
      );
    `);
    const row = await db.getFirstAsync("SELECT id FROM profile WHERE id = 1");
    if (!row) {
      await db.runAsync(
        "INSERT INTO profile (id, name, created_at) VALUES (1, ?, ?)",
        ["Auditeur", Date.now()]
      );
    }
    ready = true;
    return { ok: true };
  } catch (e) {
    initError = e?.message || String(e);
    ready = false;
    return { ok: false, error: initError };
  }
}

export const dbStatus = () => ({ ready, initError });

const guard = async (fn, fallback) => {
  if (!ready || !db) return fallback;
  try {
    return await fn();
  } catch (e) {
    console.warn("[db]", e?.message);
    return fallback;
  }
};

/* ---------------- profile ---------------- */
export const getProfile = () =>
  guard(() => db.getFirstAsync("SELECT * FROM profile WHERE id = 1"), {
    name: "Auditeur",
  });

export const setProfileName = (name) =>
  guard(() => db.runAsync("UPDATE profile SET name = ? WHERE id = 1", [name]));

/* ---------------- favorites ---------------- */
export const listFavorites = () =>
  guard(
    () => db.getAllAsync("SELECT * FROM favorites ORDER BY added_at DESC"),
    memory.favorites
  );

export const isFavorite = async (videoId) =>
  guard(async () => {
    const r = await db.getFirstAsync(
      "SELECT video_id FROM favorites WHERE video_id = ?",
      [videoId]
    );
    return !!r;
  }, false);

export const addFavorite = (t) =>
  guard(() =>
    db.runAsync(
      `INSERT OR REPLACE INTO favorites
       (video_id, title, author, thumbnail, duration, added_at)
       VALUES (?,?,?,?,?,?)`,
      [t.id, t.title, t.author ?? "", t.thumbnail ?? "", t.duration ?? 0, Date.now()]
    )
  );

export const removeFavorite = (videoId) =>
  guard(() => db.runAsync("DELETE FROM favorites WHERE video_id = ?", [videoId]));

/* ---------------- history ---------------- */
export const addHistory = (t) =>
  guard(async () => {
    await db.runAsync("DELETE FROM history WHERE video_id = ?", [t.id]);
    await db.runAsync(
      `INSERT INTO history (video_id, title, author, thumbnail, duration, played_at)
       VALUES (?,?,?,?,?,?)`,
      [t.id, t.title, t.author ?? "", t.thumbnail ?? "", t.duration ?? 0, Date.now()]
    );
    await db.runAsync(
      `DELETE FROM history WHERE id NOT IN
       (SELECT id FROM history ORDER BY played_at DESC LIMIT 100)`
    );
  });

export const listHistory = (limit = 50) =>
  guard(
    () =>
      db.getAllAsync("SELECT * FROM history ORDER BY played_at DESC LIMIT ?", [
        limit,
      ]),
    memory.history
  );

export const clearHistory = () => guard(() => db.runAsync("DELETE FROM history"));

/* ---------------- playlists ---------------- */
export const listPlaylists = () =>
  guard(
    () =>
      db.getAllAsync(`
        SELECT p.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS count
        FROM playlists p ORDER BY p.created_at DESC`),
    memory.playlists
  );

export const createPlaylist = (name) =>
  guard(async () => {
    const r = await db.runAsync(
      "INSERT INTO playlists (name, created_at) VALUES (?,?)",
      [name, Date.now()]
    );
    return r.lastInsertRowId;
  }, null);

export const deletePlaylist = (id) =>
  guard(async () => {
    await db.runAsync("DELETE FROM playlist_items WHERE playlist_id = ?", [id]);
    await db.runAsync("DELETE FROM playlists WHERE id = ?", [id]);
  });

export const listPlaylistItems = (playlistId) =>
  guard(
    () =>
      db.getAllAsync(
        "SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC",
        [playlistId]
      ),
    memory.items
  );

export const addToPlaylist = (playlistId, t) =>
  guard(async () => {
    const r = await db.getFirstAsync(
      "SELECT COALESCE(MAX(position), -1) AS p FROM playlist_items WHERE playlist_id = ?",
      [playlistId]
    );
    await db.runAsync(
      `INSERT INTO playlist_items
       (playlist_id, video_id, title, author, thumbnail, duration, position)
       VALUES (?,?,?,?,?,?,?)`,
      [
        playlistId,
        t.id,
        t.title,
        t.author ?? "",
        t.thumbnail ?? "",
        t.duration ?? 0,
        (r?.p ?? -1) + 1,
      ]
    );
  });

export const removePlaylistItem = (itemId) =>
  guard(() => db.runAsync("DELETE FROM playlist_items WHERE id = ?", [itemId]));

/* ---------------- downloads ---------------- */
export const listDownloads = () =>
  guard(() => db.getAllAsync("SELECT * FROM downloads ORDER BY created_at DESC"), []);

export const getDownload = (videoId) =>
  guard(
    () => db.getFirstAsync("SELECT * FROM downloads WHERE video_id = ?", [videoId]),
    null
  );

export const addDownload = (t, uri, bytes) =>
  guard(() =>
    db.runAsync(
      `INSERT OR REPLACE INTO downloads
       (video_id, title, author, thumbnail, duration, uri, bytes, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [t.id, t.title, t.author ?? "", t.thumbnail ?? "", t.duration ?? 0, uri, bytes ?? 0, Date.now()]
    )
  );

export const removeDownload = (videoId) =>
  guard(() => db.runAsync("DELETE FROM downloads WHERE video_id = ?", [videoId]));

/* ---------------- export / import ---------------- */
export async function exportLibrary() {
  const [playlists, favorites] = await Promise.all([
    listPlaylists(),
    listFavorites(),
  ]);
  const full = [];
  for (const p of playlists || []) {
    const items = await listPlaylistItems(p.id);
    full.push({ name: p.name, items: items || [] });
  }
  return {
    app: "AudioVibe",
    version: 1,
    exported_at: new Date().toISOString(),
    favorites: favorites || [],
    playlists: full,
  };
}

export async function importLibrary(json) {
  let added = 0;
  for (const p of json?.playlists || []) {
    const id = await createPlaylist(p.name || "Playlist importée");
    if (!id) continue;
    for (const it of p.items || []) {
      await addToPlaylist(id, {
        id: it.video_id || it.id,
        title: it.title,
        author: it.author,
        thumbnail: it.thumbnail,
        duration: it.duration,
      });
    }
    added += 1;
  }
  for (const f of json?.favorites || []) {
    await addFavorite({
      id: f.video_id || f.id,
      title: f.title,
      author: f.author,
      thumbnail: f.thumbnail,
      duration: f.duration,
    });
  }
  return added;
}
