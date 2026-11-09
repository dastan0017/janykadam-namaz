# ───── сборка ─────
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN pnpm build

# Только прод-зависимости в финальный образ.
RUN pnpm prune --prod

# ───── запуск ─────
FROM node:22-alpine
WORKDIR /app

# unzip нужен импорту GeoNames; tini — чтобы сигналы доходили до процесса.
RUN apk add --no-cache unzip tini

ENV NODE_ENV=production
# Весь расчёт времени держится на этом.
ENV TZ=UTC

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
