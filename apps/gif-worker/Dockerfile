FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./

# Utilisateur non-root — le conteneur ne manipule que des fichiers temporaires.
USER node

EXPOSE 8091
CMD ["node", "server.mjs"]
