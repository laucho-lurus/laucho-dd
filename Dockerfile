# Servidor de salas (Node + WebSocket). Node ejecuta los .ts directamente (type stripping, ≥22.18).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY db ./db
# Gasto de la IA, perfiles locales e imágenes subidas: monta aquí un volumen persistente.
ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server/main.ts"]
