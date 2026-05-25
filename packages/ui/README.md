# @app/ui

Owned, shadcn-style React components. The source lives here so agents can edit
behavior and styling without fighting a third-party library upgrade. Add new
primitives as small files; expose them from `src/index.ts`.

Styling is Tailwind v4 via `cn()` (clsx + tailwind-merge). Design tokens are
defined in `apps/web/src/styles/globals.css` under `@theme`.
