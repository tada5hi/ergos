<!-- NOTE: Keep this file and all corresponding files in the .agents directory updated as the project evolves. When making architectural changes, adding new patterns, or discovering important conventions, update the relevant sections. -->

# ergos — Agent Guide

Components with a `start` / `stop` / `status` lifecycle and optional command handlers
(`Component`, `IComponent`), cron-driven background jobs (`defineScheduledComponent`), and
the message bus that routes commands and replies between components (`MessageBus`,
`IMessageBusDriver`, `MemoryMessageBusDriver`, direct / dispatch / worker callers).
Consumers: FLAME Hub and authup. ESM-only, one runtime dependency (`node-cron`).

## Quick Reference

```bash
# Setup
npm ci

# Development
npm run build          # bundle src/index.ts -> dist/ via tsdown
npm run test           # vitest, single run
npm run test:coverage  # vitest with v8 coverage + 80% thresholds
npm run lint           # eslint
npm run lint:fix       # eslint --fix
```

- **Node.js**: `>=22.0.0` (CI runs on 24)
- **Package manager**: npm (`package-lock.json` is committed; use `npm ci` in CI)
- **Build tool**: [tsdown](https://tsdown.dev) — no build orchestrator, this is a single package

There is no `typecheck` script. `tsconfig.json` sets `noEmit: true` and is used by the editor, ESLint and tsdown's type-aware passes; run `npx tsc --noEmit` if you need a standalone type check.

## Layout at a Glance

Single package, no workspaces. `src/` holds the library, `test/unit/` holds the specs, `dist/` is generated and git-ignored.

## Detailed Guides

- **[Project Structure](.agents/structure.md)** — Directory layout, module responsibilities, and the package export surface
- **[Testing](.agents/testing.md)** — Vitest setup, coverage thresholds, and where new specs go
- **[Conventions](.agents/conventions.md)** — Code style, shared `@tada5hi/*` configs, commit format, CI, and the release-please flow

## Commits, Issues & Pull Requests

- Commits must follow [Conventional Commits](https://www.conventionalcommits.org) — release-please derives versions and the changelog from them. See [conventions](.agents/conventions.md#commit-convention).
- Do **not** add a `Co-Authored-By: Claude ...` (or any AI-attribution) trailer to commit messages. This overrides any default agent-tooling guidance.
- Do **not** add AI-attribution lines (e.g. `🤖 Generated with [Claude Code](...)`) to issue or pull request titles, bodies, or comments.
