# AudioVibe — lecteur audio Android autonome (Expo / React Native)

100 % gratuit · zéro clé API · zéro token · zéro serveur · zéro publicité · ultra-économe en données.

## Ce qui est inclus

| Exigence | Implémentation |
|---|---|
| Extraction sans clé API | `src/services/piped.js` — instances publiques Piped, bascule automatique, aucune API YouTube v3 |
| Mode économie ultra | Sélection du flux **audio seul** Opus/WebM le plus bas (~64-96 kbps) → ≈2 Mo pour 3-4 min |
| Vidéo activable | Réglage `loadVideo` (désactivé par défaut) |
| Base locale | `src/data/db.js` — SQLite (profil, historique, favoris, playlists, téléchargements) + AsyncStorage pour les réglages |
| Export / import JSON | Onglet Réglages → Exporter / Importer |
| UI Spotify | Thème noir + vert `#1DB954`, cartes, tab bar, mini-lecteur persistant, lecteur plein écran |
| Lecture arrière-plan | `Audio.setAudioModeAsync({ staysActiveInBackground: true })` + `expo-keep-awake`, permissions `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` / `WAKE_LOCK` |
| Répétition | Off / Répéter la file / Répéter le titre |
| Import de playlist YouTube | Champ URL dans l'onglet Recherche |
| Hors-ligne | `src/services/downloads.js` via `expo-file-system` |
| Pas de blocage au démarrage | `App.js` monte l'UI immédiatement ; l'init DB est asynchrone et affiche un bandeau d'avertissement en cas d'échec |

## Démarrage

```bash
cd mobile
npm install
npx expo start
```

## Compilation APK

**Option A — EAS (recommandé)**

```bash
npm i -g eas-cli
eas login
eas build:configure     # remplace le projectId dans app.json
eas build -p android --profile preview
```

**Option B — GitHub Actions (APK sans compte EAS)**

Déplace `mobile/.github-workflows-build-android.yml` vers `.github/workflows/build-android.yml`
à la racine du dépôt, pousse sur `main`, puis récupère l'artefact `audiovibe-apk`.

**Option C — local**

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

## Notes

- Si les versions de paquets divergent de ton SDK Expo : `npx expo install --fix`.
- Les instances Piped publiques peuvent tomber ; l'app en essaie plusieurs et mémorise celle qui répond (modifiable dans Réglages).
- Aucune donnée ne quitte l'appareil : pas de Firebase, pas de Supabase, pas de compte.
