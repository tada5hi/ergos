# Project Structure

Single npm package — no workspaces, no monorepo tooling.

## Directory Layout

```
ergos/
├── src/
│   ├── index.ts                     # Public entry point; everything exported here is public API
│   ├── types.ts                     # ObjectLiteral, ILogger
│   ├── component/                   # IComponent, Component, defineScheduledComponent
│   ├── caller/                      # IComponentCaller + direct / dispatch / worker callers
│   ├── message-bus/                 # MessageBus, IMessageBusDriver, MemoryMessageBusDriver, helpers
│   └── amqp/                        # subpath ergos/amqp: AmqpMessageBusDriver, IAmqpClient
├── test/
│   ├── unit/
│   │   ├── *.spec.ts                # One spec per module
│   │   ├── fakes/                   # Shared fakes (logger, test component, amqp client)
│   │   └── fixtures/hub-wire.ts     # Wire tuples captured from hub's former driver
│   └── vitest.config.ts             # Vitest config — note: NOT in the project root
├── dist/                            # Build output (git-ignored, produced by tsdown)
├── .github/
│   ├── assets/
│   │   └── logo.svg             # README header logo (referenced by relative path)
│   ├── actions/
│   │   ├── install/action.yml       # Composite action: setup-node + cache + npm ci
│   │   └── build/action.yml         # Composite action: cache dist/ by SHA + npm run build
│   ├── workflows/
│   │   ├── main.yml                 # CI: install -> build -> (lint, test)
│   │   └── release.yml              # release-please -> build -> publish via tada5hi/monoship
│   ├── ISSUE_TEMPLATE/              # Bug report / feature request forms
│   └── dependabot.yml               # Daily npm + github-actions updates, grouped by major/minor
├── .husky/                          # Git hooks dir (core.hooksPath); no hooks are committed
├── .agents/                         # Agent guides (this directory)
├── AGENTS.md                        # Agent entry point
├── CLAUDE.md                        # Manifest that loads AGENTS.md + .agents/*.md
├── tsconfig.json                    # extends @tada5hi/tsconfig; noEmit
├── tsdown.config.ts                 # Bundler config (esm, dts, sourcemap)
├── eslint.config.js                 # Flat config wrapping @tada5hi/eslint-config
├── commitlint.config.mjs            # extends @tada5hi/commitlint-config
├── release-please-config.json       # Release automation config
└── .release-please-manifest.json    # Current released version (source of truth for bumps)
```

## Module Responsibilities

| Module                       | Purpose |
|------------------------------|---------|
| `src/component/module.ts`    | `Component`: key → handler map, `'*'` fallback, memoized `initialize()`, child events via `context.handle`, unhandled → `options.handle`, status of top-level calls |
| `src/component/scheduled.ts` | `defineScheduledComponent`: first pass on start, node-cron schedule with `noOverlap`, failures logged, stop-during-start never schedules |
| `src/caller/`                | `DirectComponentCaller` (in-process), `MessageBusDispatchComponentCaller` (publish a command), `MessageBusWorkerComponentCaller` (consume a routing, publish replies; itself an `IComponent`) |
| `src/message-bus/`           | `MessageBus` facade (`$any` fallback), `IMessageBusDriver` / `IMessageBusConsumer`, `MemoryMessageBusDriver` (WORK round-robin, PUB_SUB fan-out, `cancel()` awaits in-flight handlers), payload helpers |
| `src/amqp/`                  | `AmqpMessageBusDriver`: routing → exchange/queue options, publish properties, parse + guard; retry and the redelivery guard are amqp-extension's (`retry`, `ordered` consume options) |

## Key Dependencies

- `node-cron` — the only runtime dependency (scheduled components).
- `amqp-extension` — optional peer (`^5.1.0`) of the `ergos/amqp` subpath only; the core entry never imports it.

## Package Exports

```json
{
    "main": "dist/index.mjs",
    "types": "dist/index.d.mts",
    "exports": {
        "./package.json": "./package.json",
        ".": {
            "types": "./dist/index.d.mts",
            "import": "./dist/index.mjs"
        },
        "./amqp": {
            "types": "./dist/amqp/index.d.mts",
            "import": "./dist/amqp/index.mjs"
        }
    },
    "files": ["dist"]
}
```

- **ESM-only.** There is no `require` condition and no CJS output; `"type": "module"` is set. Do not add a CJS build unless a consumer explicitly needs one.
- Only `dist/` is published (`files`), so anything not reachable from `src/index.ts` never ships.
- `src/index.ts` is the single public surface: if a symbol is not exported there, it is internal. Add new modules under `src/` and re-export them from `index.ts`.

## Separation of Concerns

- **Library code** → `src/`
- **Tests** → `test/unit/` (mirrors the `src/` file it covers; the spec `describe` block names the source file, e.g. `describe('src/index.ts', ...)`)
- **Build / bundling** → `tsdown.config.ts`
- **Lint / style / commit rules** → shared `@tada5hi/*` configs, thinly wrapped by the local config files
- **CI, release, dependency updates** → `.github/`
