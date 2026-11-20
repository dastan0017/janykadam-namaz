# Образ входной двери: собранная панель внутри Caddy.
#
# Контекст сборки — корень репозитория, потому что нужна папка admin-panel.

# ───── сборка панели ─────
FROM node:22-alpine AS build
WORKDIR /app

COPY admin-panel/package.json admin-panel/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY admin-panel/ ./

# Адрес API пустой: панель и бэкенд на одном origin, запросы идут на /api.
ARG VITE_API_URL=""
ARG VITE_BOT_USERNAME=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME
ENV VITE_USE_SEED=false
RUN npm run build

# ───── отдача ─────
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
