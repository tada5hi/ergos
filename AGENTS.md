<!-- NOTE: Keep this file and all corresponding files in the .agents directory updated as the project evolves. When making architectural changes, adding new patterns, or discovering important conventions, update the relevant sections. -->

# synergos — Agent Guide

An npm workspaces monorepo with two packages:

- **`synergos`** (`packages/synergos`) — components with a `start` / `stop` / `status` lifecycle and
  optional command handlers (`Component`, `IComponent`), cron-driven background jobs
  (`defineScheduledComponent`), and the message bus that routes commands and replies between
  components (`IMessageBus` / `MessageBus`, `IMessageBusDriver`, `MemoryMessageBusDriver`,
  `DirectCaller` / `DispatchCaller` / `WorkerCaller`). One runtime dependency (`node-cron`).
- **`@synergos/amqp`** (`packages/amqp`) — `AmqpMessageBusDriver` over
  [amqp-extension](https://www.npmjs.com/package/amqp-extension) (a real dependency);
  `synergos` is a peer.

Consumers: FLAME Hub and authup. ESM-only. Observability is through typed `hooks` options,
not a logger.

## Quick Reference

```bash
# Setup
npm ci

# Development (root; nx run-many across packages/*)
npm run build          # per package: tsc --noEmit (src) + tsdown -> dist/
npm run test           # vitest, single run
npm run test:coverage  # vitest with v8 coverage + 80% thresholds
npm run typecheck      # tsc --noEmit over src + test, per package
npm run lint           # eslint (root config, all packages)
npm run lint:fix       # eslint --fix

# One package
npm run test -w packages/amqp
```

- **Node.js**: `>=22.0.0` (CI runs on 24)
- **Package manager**: npm workspaces (`package-lock.json` is committed; use `npm ci` in CI;
  regenerate with a plain `npm install`, never `--package-lock-only` or `--force`)
- **Build**: [tsdown](https://tsdown.dev) per package, orchestrated by [nx](https://nx.dev)

## Layout at a Glance

`packages/<name>/` each with `src/`, `test/unit/`, `test/vitest.config.ts`, `tsdown.config.ts`,
`tsconfig.json` (src + test, paths-mapped to sibling sources) and `tsconfig.build.json` (src only).
`dist/` is generated and git-ignored.

## Detailed Guides

- **[Project Structure](.agents/structure.md)** — Directory layout, module responsibilities, and the package export surface
- **[Testing](.agents/testing.md)** — Vitest setup, coverage thresholds, and where new specs go
- **[Conventions](.agents/conventions.md)** — Code style, shared `@tada5hi/*` configs, commit format, CI, and the release-please flow

## Commits, Issues & Pull Requests

- Commits must follow [Conventional Commits](https://www.conventionalcommits.org) — release-please derives versions and the changelog from them. See [conventions](.agents/conventions.md#commit-convention).
- Do **not** add a `Co-Authored-By: Claude ...` (or any AI-attribution) trailer to commit messages. This overrides any default agent-tooling guidance.
- Do **not** add AI-attribution lines (e.g. `🤖 Generated with [Claude Code](...)`) to issue or pull request titles, bodies, or comments.
