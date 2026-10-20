FROM node:20-alpine

# ffmpeg (trim + GIF) et yt-dlp (téléchargement vidéo par lien, paquet
# Alpine community — tire python3 automatiquement, pas besoin de pip).
RUN apk add --no-cache ffmpeg yt-dlp

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./

# Utilisateur non-root — le conteneur ne manipule que des fichiers temporaires.
USER node

EXPOSE 8091
CMD ["node", "server.mjs"]
