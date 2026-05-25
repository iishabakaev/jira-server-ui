#!/bin/sh
# Один образ — три роли. Переключение через ROLE.
# api    — Elysia HTTP + SSE (по умолчанию).
# worker — pg-boss консьюмер тасков.
# web    — статика SPA, отдаётся `bun --static`.
# migrate — одноразово применить миграции и выйти.
set -eu

ROLE="${ROLE:-api}"

case "$ROLE" in
  api)
    # Применяем миграции до старта (форвард-онли; idempotent). Падение
    # миграции — фейл контейнера; api не должен подниматься поверх
    # частично обновлённой БД (см. docs/specs/05-sync-engine.md).
    bun /app/db/migrate.js
    exec bun /app/server/index.js
    ;;
  worker)
    exec bun /app/jobs/index.js
    ;;
  web)
    # Bun.serve со встроенным static и SPA-fallback. См. infra/docker/web-static.ts.
    exec bun /app/web-static/web-static.js
    ;;
  migrate)
    exec bun /app/db/migrate.js
    ;;
  *)
    echo "unknown ROLE: $ROLE (allowed: api|worker|web|migrate)" >&2
    exit 2
    ;;
esac
