# Havamania Platform: üretim imajı (Next.js standalone).
#   docker build -t havamania-platform .
# Veritabanı kurulumu için aynı Dockerfile'ın "tools" aşaması kullanılır (docker-compose.prod.yml).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Derleme sırasında veritabanına bağlanılmaz; modül yüklenirken değişkenin var olması yeter.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

# Şema ve seed komutları için (drizzle-kit, tsx dahil tam bağımlılıklar).
FROM build AS tools
ENV NODE_ENV=production

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_LOCAL_DIR=/app/storage
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/storage && chown app:app /app/storage
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
