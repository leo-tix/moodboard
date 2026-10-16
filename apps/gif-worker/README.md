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
