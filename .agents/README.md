# .agents/

AI-native conventions for this repository. Read these files before editing
code or generating files. They encode hard constraints that the rest of the
codebase assumes.

- `CODEBASE_MAP.md` — one paragraph per top-level folder. Update by hand
  when a new top-level folder appears.
- `PATTERNS.md` — copy-pasteable templates: "add a route", "add an outbox
  kind", "add a schema table", "add a feature".
- `DO_NOT.md` — anti-patterns that must never appear in this repo.

Specs live in `docs/specs/`. When a spec and a `.agents/` rule diverge,
fix the divergence — do not silently follow one and ignore the other.

## Code language

- Code comments: **Russian**. Identifiers, file names, route paths, and
  external-facing strings: English.
- Specs and `.agents/` files: English.
