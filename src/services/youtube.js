/**
 * Extraction audio 100 % locale (embarquée dans le téléphone).
 * Aucune instance Piped/Invidious, aucun serveur tiers, aucune clé API privée :
 * on parle directement au endpoint InnerTube public de YouTube depuis l'appareil,
 * exactement comme le fait l'application YouTube Android.
 */

const INNERTUBE_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const BASE = "https://www.youtube.com/youtubei/v1";

/** Clients InnerTube utilisés localement, par ordre de préférence.
 *  ANDROID_VR / IOS / TVHTML5 ne réclament pas de "poToken" : ce sont eux qui
 *  passent quand le client ANDROID classique renvoie UNPLAYABLE. */
export const CLIENTS = [
  {
    id: "ANDROID_VR",
    label: "Android VR (local)",
    context: {
      clientName: "ANDROID_VR",
      clientVersion: "1.61.43",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
      hl: "fr",
    },
    ua: "com.google.android.apps.youtube.vr.oculus/1.61.43 (Linux; U; Android 12L) gzip",
    clientNameHeader: "28",
  },
  {
    id: "IOS",
    label: "iOS (local)",
    context: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
      hl: "fr",
    },
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)",
    clientNameHeader: "5",
  },
  {
    id: "TVHTML5",
    label: "TV intégrée (local)",
    context: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      hl: "fr",
    },
    ua: "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
    clientNameHeader: "85",
    embed: true,
  },
  {
    id: "ANDROID",
    label: "Android (local)",
    context: {
      clientName: "ANDROID",
      clientVersion: "19.44.38",
      androidSdkVersion: 30,
      osName: "Android",
      osVersion: "11",
      hl: "fr",
    },
    ua: "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip",
    clientNameHeader: "3",
  },
  {
    id: "WEB",
    label: "Web (local)",
    context: {
      clientName: "WEB",
      clientVersion: "2.20240401.00.00",
      hl: "fr",
    },
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    clientNameHeader: "1",
  },
];


let preferredClient = null;
export function setPreferredClient(id) {
  preferredClient = id;
}
export function getPreferredClient() {
  return preferredClient;
}

function orderedClients() {
  if (!preferredClient) return CLIENTS;
  const first = CLIENTS.filter((c) => c.id === preferredClient);
  return [...first, ...CLIENTS.filter((c) => c.id !== preferredClient)];
}

async function innertube(endpoint, body, client, { region = "FR", ms = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${BASE}/${endpoint}?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": client.ua,
        "X-YouTube-Client-Name": client.clientNameHeader,
        "X-YouTube-Client-Version": client.context.clientVersion,
        Origin: "https://www.youtube.com",
      },
      body: JSON.stringify({
        context: {
          client: { ...client.context, gl: region },
          user: { lockedSafetyMode: false },
        },
        ...body,
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function anyClient(endpoint, body, opts) {
  let lastErr;
  for (const client of orderedClients()) {
    try {
      const data = await innertube(endpoint, body, client, opts);
      return { data, client };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    "Extraction locale impossible (" + (lastErr?.message || "réseau") + ")"
  );
}

/* ---------- parsing ---------- */

function collect(node, key, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, key, out);
    return out;
  }
  for (const k of Object.keys(node)) {
    if (k === key && node[k] && typeof node[k] === "object") out.push(node[k]);
    else collect(node[k], key, out);
  }
  return out;
}

const textOf = (t) =>
  t?.simpleText ||
  (Array.isArray(t?.runs) ? t.runs.map((r) => r.text).join("") : "") ||
  "";

function durationToSec(str = "") {
  const parts = String(str).split(":").map((n) => parseInt(n, 10));
  if (parts.some(isNaN) || !parts.length) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function mapRenderer(v) {
  const id = v.videoId;
  if (!id) return null;
  const thumbs = v.thumbnail?.thumbnails || [];
  return {
    id,
    title: textOf(v.title) || "Sans titre",
    author:
      textOf(v.ownerText) ||
      textOf(v.longBylineText) ||
      textOf(v.shortBylineText) ||
      "",
    thumbnail: thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration:
      durationToSec(textOf(v.lengthText)) ||
      Number(v.lengthSeconds || 0) ||
      0,
  };
}

function extractVideos(data) {
  const nodes = [
    ...collect(data, "videoRenderer"),
    ...collect(data, "compactVideoRenderer"),
    ...collect(data, "playlistVideoRenderer"),
    ...collect(data, "gridVideoRenderer"),
  ];
  const seen = new Set();
  const out = [];
  for (const n of nodes) {
    const t = mapRenderer(n);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

/* ---------- API publique (identique à l'ancienne) ---------- */

export async function searchTracks(query) {
  // params = filtre "vidéos" trié par pertinence
  const { data } = await anyClient("search", {
    query,
    params: "EgIQAQ%3D%3D",
  });
  const list = extractVideos(data);
  if (list.length) return list;
  const retry = await anyClient("search", { query });
  return extractVideos(retry.data);
}

export async function trending(region = "FR") {
  try {
    const { data } = await anyClient("browse", { browseId: "FEtrending" }, { region });
    const list = extractVideos(data).filter((t) => t.duration > 0);
    if (list.length) return list;
  } catch {}
  // Repli local : une recherche générique reste 100 % côté appareil.
  return searchTracks("top hits musique " + region);
}

/** Accepte une URL complète de playlist YouTube ou un id brut. */
export async function fetchPlaylist(urlOrId) {
  const m = String(urlOrId).match(/list=([A-Za-z0-9_-]+)/);
  const id = m ? m[1] : String(urlOrId).trim();
  const browseId = id.startsWith("VL") ? id : "VL" + id;
  const { data } = await anyClient("browse", { browseId });
  const name =
    textOf(data?.header?.playlistHeaderRenderer?.title) ||
    textOf(data?.metadata?.playlistMetadataRenderer?.title) ||
    "Playlist importée";
  return { name, items: extractVideos(data) };
}

/**
 * Économie de données maximale : on ne garde que les flux audio-only
 * (Opus/WebM bas débit ~64-96 kbps => ~2 Mo pour 3-4 min).
 * On essaie chaque client local jusqu'à en trouver un qui rend un flux jouable
 * (ANDROID renvoie souvent UNPLAYABLE, ANDROID_VR / IOS / TV prennent le relais).
 */
/** En-têtes exigés par googlevideo pour rejouer une URL : elle est liée au
 *  client (UA) qui l'a demandée. Sans eux ExoPlayer reçoit un 403. */
export function streamHeaders(clientId) {
  const c = CLIENTS.find((x) => x.id === clientId) || CLIENTS[0];
  return {
    "User-Agent": c.ua,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  };
}

/** Vérifie que l'URL est réellement lisible (googlevideo renvoie parfois 403
 *  sur une URL pourtant présente dans la réponse player). */
async function probe(url, headers, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { ...headers, Range: "bytes=0-1" },
    });
    // 200 (serveur ignorant Range) ou 206 = flux jouable.
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Économie de données maximale : on ne garde que les flux audio-only
 * (Opus/WebM bas débit ~64-96 kbps => ~2 Mo pour 3-4 min).
 * On essaie chaque client local jusqu'à en trouver un dont l'URL répond
 * réellement (et non un 403 au moment de la lecture).
 */
export async function getAudioStream(videoId, { hifi = false } = {}) {
  let lastErr;
  let lastReason;
  for (const client of orderedClients()) {
    try {
      const body = {
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: {
          contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" },
        },
      };
      if (client.embed) {
        body.thirdParty = { embedUrl: "https://www.youtube.com/" };
      }
      const data = await innertube("player", body, client);

      const status = data?.playabilityStatus?.status;
      const reason =
        textOf(data?.playabilityStatus?.reason) ||
        data?.playabilityStatus?.reason ||
        "";
      if (status && status !== "OK") {
        lastReason = reason || status;
        throw new Error(status);
      }

      const formats = [
        ...(data?.streamingData?.adaptiveFormats || []),
        ...(data?.streamingData?.formats || []),
      ];
      // Un flux sans `url` (signatureCipher) n'est pas lisible localement.
      const audio = formats.filter(
        (f) => f.url && /audio\//i.test(f.mimeType || "")
      );
      if (!audio.length) throw new Error("Aucun flux audio");

      const opus = audio.filter((f) => /opus|webm/i.test(f.mimeType || ""));
      const pool = opus.length ? opus : audio;
      const sorted = [...pool].sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));

      const preferred = hifi
        ? sorted[sorted.length - 1]
        : sorted.find((f) => (f.bitrate || 0) >= 48000) || sorted[0];

      // Ordre d'essai : le format voulu d'abord, puis les autres en secours.
      const candidates = [preferred, ...sorted.filter((f) => f !== preferred)];
      const headers = streamHeaders(client.id);

      let chosen = null;
      for (const f of candidates) {
        if (await probe(f.url, headers)) {
          chosen = f;
          break;
        }
      }
      if (!chosen) throw new Error("403");

      setPreferredClient(client.id);
      const details = data?.videoDetails || {};
      const thumbs = details.thumbnail?.thumbnails || [];
      return {
        url: chosen.url,
        headers,
        client: client.id,
        bitrate: chosen.bitrate || 0,
        mime: chosen.mimeType || "audio/webm",
        title: details.title,
        author: details.author,
        thumbnail: thumbs[thumbs.length - 1]?.url || "",
        duration: Number(details.lengthSeconds || 0),
        videoUrl:
          formats.find((f) => f.url && /video\//i.test(f.mimeType || ""))?.url || null,
      };
    } catch (e) {
      lastErr = e;
      // Ce client est grillé pour cette session : on ne le remet pas en tête.
      if (preferredClient === client.id) preferredClient = null;
    }
  }
  throw new Error(
    "Lecture impossible pour ce titre (" +
      (lastReason || lastErr?.message || "réseau") +
      ")"
  );
}


export const estimateSizeMb = (bitrate, durationSec) =>
  (((bitrate || 64000) / 8) * (durationSec || 0)) / 1024 / 1024;
