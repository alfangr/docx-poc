<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Documentation sync

- Treat documentation as part of every code change, not as a follow-up task.
- Whenever behavior, UI, configuration, commands, architecture, dependencies,
  limits, or file structure changes, update the relevant files in `README.md`
  and/or `docs/` in the same change.
- Documentation must describe the actual current implementation. Verify names,
  paths, limits, defaults, and examples against the code before finishing.
- Remove or correct stale statements discovered while working, even when they
  predate the current change and concern the same area.
- If a code change genuinely requires no documentation update, explicitly note
  that in the final handoff instead of silently skipping the check.
