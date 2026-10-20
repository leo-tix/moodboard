# gif-worker

Service autonome : reçoit une courte vidéo + un intervalle (`start`/`end` en
secondes), renvoie un GIF. Tourne sur le VPS OVH (`gif.leotix.fr`), appelé
server-to-server depuis `apps/web` — jamais exposé au navigateur directement.

## API

`GET /health` → `{ ok: true }`

`POST /convert` (multipart/form-data, header `Authorization: Bearer <GIF_WORKER_TOKEN>`)
- `file` : la vidéo (champ fichier)
- `start`, `end` : secondes (nombres, `end - start` ≤ `MAX_DURATION_S`, 15s par défaut)
- `fps` (optionnel, défaut 12), `width` (optionnel, défaut 480)
- Réponse : `image/gif` en streaming, ou `{ error, message? }` en JSON si échec.

`POST /meta-url` (JSON `{ url }`, même header `Authorization`) — métadonnées
d'une vidéo par lien (TikTok/Instagram/générique), SANS téléchargement
(`yt-dlp -J --skip-download`). Appelé server-à-serveur par apps/web.
- Réponse : `{ title, durationS, approxBytes }` (`approxBytes` peut être
  `null` si yt-dlp ne le donne pas), ou `{ error, message? }` si échec.

`POST /fetch-url` (JSON `{ url }`, même header `Authorization` — jeton
STATIQUE server-à-serveur ou TICKET signé côté navigateur, comme `/convert`)
— télécharge la vidéo complète via `yt-dlp` et la streame en réponse.
- Réponse : la vidéo (`video/mp4` ou équivalent) en streaming, ou
  `{ error, message? }` en JSON si échec (vidéo privée, géo-bloquée, trop
  longue/lourde…).

Nécessite le binaire `yt-dlp` dans l'environnement (voir Dockerfile —
paquet Alpine `yt-dlp` ; en local, installer via `pip install yt-dlp` ou le
gestionnaire de paquets du système).

## Déploiement (VPS)

```bash
cd /opt/moodboard-gif
cp .env.example .env
# éditer .env : GIF_WORKER_TOKEN=<le même jeton que côté Vercel>
docker compose up -d --build
curl http://127.0.0.1:8091/health
```

Mise à jour après un changement de code :
```bash
cd /opt/moodboard-gif
git pull   # ou re-sync des fichiers
docker compose up -d --build
```

Logs : `docker compose logs -f gif-worker`
