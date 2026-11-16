# syntax=docker/dockerfile:1

# ---- build: compile the React frontend into static files --------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src

# YYYYMMDD shown in the footer; defaults to the build date.
ARG BUILD_STAMP=""
ENV BUILD_STAMP=${BUILD_STAMP}
RUN npm run build

# ---- runtime: the Node server and the built frontend, nothing else ----------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/dist
WORKDIR /app

# Only the server's own dependencies (express, pg); the frontend libraries are
# already bundled into dist/.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
# The server scores submissions with the same engine and frameworks the
# browser uses, so the 80% completion gate cannot be argued with.
COPY src/lib/scoring.js ./src/lib/scoring.js
COPY src/framework/framework-2025.json src/framework/framework-2025-district.json ./src/framework/
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1

CMD ["node", "server/index.js"]
