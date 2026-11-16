# DHIS2 Analysis — production image.
#
#   docker build -t dhis2-analysis .
#   docker run -d -p 3000:3000 --name dhis2-analysis dhis2-analysis
#
# Three stages: install, test and build, then a small runtime that holds only
# the standalone server — no source, no dev dependencies, no build tools.

# ---- 1. dependencies ------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. test and build ----------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The data-layer suite guards the numbers on screen and the proxy allowlist;
# an image is not built from code that fails it.
RUN npm test
RUN npm run build

# ---- 3. runtime -----------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AUTH_STORE=/data/users.json

# /data holds the site's account file (scrypt hashes only), on a volume so a
# rebuilt container keeps the accounts. See docker-compose.yml.
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
 && mkdir -p /data && chown nextjs:nodejs /data && chmod 700 /data

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Makes AUTH_SECRET and AUTH_USERS values without Node on the host:
#   docker compose run --rm dhis2-analysis node scripts/hash-password.mjs --secret
COPY --from=build --chown=nextjs:nodejs /app/scripts/hash-password.mjs ./scripts/hash-password.mjs

USER nextjs
VOLUME ["/data"]
EXPOSE 3000

# A static file proves the server is up without calling DHIS2 on every check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/favicon.ico').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
