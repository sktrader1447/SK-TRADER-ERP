# Multi-Company ERP — production image
# Works on Render (Docker), Railway (Dockerfile), Fly.io, or any Docker host.
FROM node:20-slim AS build

WORKDIR /app
COPY package*.json ./
# better-sqlite3 ships prebuilt binaries; if a platform has none we fall back to source build.
RUN npm install --production || npm install

COPY . .
# Keep `public` (frontend); only clear any local dev database so the container
# starts fresh (data lives on the persistent /data volume in production).
RUN rm -rf data/*.db* test 2>/dev/null || true

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app

# Use a mounted/persistent volume for data when available, else default ./data
ENV DATA_DIR=/data
VOLUME /data

COPY --from=build /app /app

EXPOSE 3000
CMD ["node", "server.js"]
