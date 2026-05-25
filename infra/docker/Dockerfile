# syntax=docker/dockerfile:1.7
# Один продуктовый образ. Внутри лежат три entry-point'а — api, worker, web,
# выбор делается через ROLE-переменную в entrypoint.sh.
# См. docs/specs/02-project-structure.md.

# ---- build ----
FROM oven/bun:1.2 AS build
WORKDIR /repo

# Сначала только манифесты — даёт максимально длинный bun-install кэш.
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/jobs/package.json apps/jobs/
COPY packages/db/package.json packages/db/
COPY packages/eden/package.json packages/eden/
COPY packages/jira/package.json packages/jira/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/

RUN bun install --frozen-lockfile

# Теперь весь монорепо.
COPY . .

# Билды четырёх ролей: server, jobs, db-migrate, web-static (статика для роли web).
RUN bun run --filter @app/web build \
  && bun build apps/server/src/index.ts        --outdir dist/server      --target bun \
  && bun build apps/jobs/src/index.ts          --outdir dist/jobs        --target bun \
  && bun build packages/db/src/migrate.ts      --outdir dist/db          --target bun \
  && bun build infra/docker/web-static.ts      --outdir dist/web-static  --target bun

# ---- runtime ----
# `slim` (не distroless) даёт минимальный sh — entrypoint.sh умеет
# переключать ROLE одной командой. distroless не имеет /bin/sh.
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

# Скомпилированные роли.
COPY --from=build /repo/dist /app
# SPA-бандл; путь WEB_DIR используется web-static.
COPY --from=build /repo/apps/web/dist /app/web
# Миграции лежат на одном уровне с скомпилированным migrate.js
# (см. comment в packages/db/src/migrate.ts).
COPY --from=build /repo/packages/db/drizzle /app/drizzle
COPY infra/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIR=/app/web

EXPOSE 3000 8080
USER bun
ENTRYPOINT ["/entrypoint.sh"]
