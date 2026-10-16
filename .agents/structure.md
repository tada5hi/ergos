# Project Structure

npm workspaces monorepo (`packages/*`), orchestrated by nx.

## Directory Layout

```
synergos/
├── packages/
│   ├── synergos/                        # package `synergos` (core)
│   │   ├── src/
│   │   │   ├── index.ts                 # Public entry point; everything exported here is public API
│   │   │   ├── types.ts                 # ObjectLiteral
│   │   │   ├── hook/                    # invokeHook (guarded hook call), HookArgs
│   │   │   ├── component/               # IComponent, Component, defineScheduledComponent
│   │   │   ├── caller/                  # ICaller + DirectCaller / DispatchCaller / WorkerCaller
│   │   │   └── message-bus/             # IMessageBus, MessageBus, IMessageBusDriver, MemoryMessageBusDriver, message helpers
│   │   ├── test/
│   │   │   ├── unit/*.spec.ts           # One spec per module
│   │   │   ├── unit/fakes/              # TestComponent, FakeMessageBus
│   │   │   └── vitest.config.ts
│   │   ├── package.json, README.md, LICENSE
│   │   ├── tsconfig.json                # src + test (paths-mapped), used by `typecheck`
│   │   ├── tsconfig.build.json          # src only, resolved through node_modules; used by `build:types`
│   │   └── tsdown.config.ts             # esm, dts, sourcemap
│   └── amqp/                            # package `@synergos/amqp`
│       ├── src/                         # AmqpMessageBusDriver, IAmqpClient, hook/event types
│       ├── test/
│       │   ├── unit/driver.spec.ts
│       │   ├── unit/fakes/amqp-client.ts
│       │   ├── unit/fixtures/hub-wire.ts  # Wire tuples captured from hub's former driver
│       │   └── vitest.config.ts         # aliases `synergos` to ../synergos/src (no build needed)
│       └── package.json, README.md, LICENSE, tsconfig*.json, tsdown.config.ts
├── .github/
│   ├── assets/                          # README graphics, referenced by absolute raw.githubusercontent URLs from the package READMEs (npm)
│   │   ├── logo.svg, logo-amqp.svg      # header logos (synergos, @synergos/amqp)
│   │   └── architecture.svg, component.svg, amqp-retry.svg  # diagrams; light/dark via prefers-color-scheme
│   ├── actions/install/action.yml       # setup-node + cache (node_modules, packages/*/node_modules) + npm ci
│   ├── actions/build/action.yml         # cache **/dist by SHA + npm run build
│   ├── workflows/main.yml               # CI: install -> build -> (lint, typecheck, test)
│   ├── workflows/release.yml            # release-please -> build -> publish via tada5hi/monoship
│   ├── ISSUE_TEMPLATE/
│   └── dependabot.yml
├── .husky/                              # Git hooks dir (core.hooksPath); no hooks are committed
├── .agents/                             # Agent guides (this directory)
├── AGENTS.md, CLAUDE.md, README.MD
├── package.json                         # private root: workspaces, nx run-many scripts, shared devDependencies
├── nx.json                              # build dependsOn ^build; cacheable build/lint/test/typecheck
├── tsconfig.build.json                  # shared compiler options (extends @tada5hi/tsconfig)
├── tsconfig.json                        # + paths: synergos / @synergos/amqp -> packages/*/src
├── eslint.config.js                     # flat config wrapping @tada5hi/eslint-config
├── commitlint.config.mjs
├── release-please-config.json           # monorepo mode, node-workspace plugin
└── .release-please-manifest.json        # one version per package path
```

## Module Responsibilities

| Module | Purpose |
|---|---|
| `synergos/src/component/module.ts` | `Component`: key → handler map, `'*'` fallback, per-handler memoized `initialize()`, child events via `context.handle`, unhandled → `options.handle`, status of top-level calls |
| `synergos/src/component/scheduled.ts` | `defineScheduledComponent`: first pass on start, node-cron schedule with `noOverlap`, a failed pass → `hooks.onError`, stop-during-start never schedules |
| `synergos/src/caller/` | `DirectCaller` (in-process), `DispatchCaller` (publish a command; `onUndelivered`), `WorkerCaller` (consume a routing, publish replies; itself an `IComponent`; `onUnrouted`). Both bus callers require an `IMessageBus` |
| `synergos/src/message-bus/` | `IMessageBus` + `MessageBus` (type dispatch with `'*'` fallback; `onPublish` / `onConsume` / `onUnhandled` / `onError` hooks), `IMessageBusDriver` / `IMessageBusConsumer`, `MemoryMessageBusDriver` (WORK round-robin, PUB_SUB fan-out, `cancel()` awaits in-flight handlers), `buildMessage` / `isMessage` / `serializeMessage` |
| `synergos/src/hook/` | `invokeHook(hooks, name, ...args)`: calls a hook with `hooks` as `this` and ignores a throw or a rejected promise |
| `amqp/src/` | `AmqpMessageBusDriver`: routing → exchange/queue options, publish properties, decode + guard (`onMalformed`), retry/drop reporting (`onRetry` / `onDrop`); retry and the redelivery guard are amqp-extension's |

## Hooks

Every observable event is an optional, typed hook on the class's `hooks` option; the hook
types sit in the module's `types.ts` (`MessageBusHooks`, `DispatchCallerHooks`,
`WorkerCallerHooks`, `ScheduledComponentHooks`, `AmqpMessageBusDriverHooks`). Call them only
through `invokeHook`: hooks observe and must never change an outcome — every hook site can sit
on a consume path, where a propagated error would turn an ack into a retry.

## Key Dependencies

- `synergos`: `node-cron` (scheduled components), its only runtime dependency. It never imports amqp-extension.
- `@synergos/amqp`: `amqp-extension` (`^5.1.1`, dependency) and `synergos` (peer + dev, workspace version; release-please's node-workspace plugin bumps the range).

## Package Exports

Both packages publish only `dist/` (plus README/LICENSE) with a single `.` export:

```json
{
    "main": "dist/index.mjs",
    "types": "dist/index.d.mts",
    "exports": {
        "./package.json": "./package.json",
        ".": { "types": "./dist/index.d.mts", "import": "./dist/index.mjs" }
    },
    "files": ["dist"]
}
```

- **ESM-only.** No CJS output; `"type": "module"`.
- `src/index.ts` is each package's single public surface: a symbol not exported there is internal.
- After changing an `exports` map, verify by hand: `npm run build`, then
  `node --input-type=module -e "await import('./packages/<pkg>/dist/index.mjs')"` and
  `npm pack --dry-run -w packages/<pkg>`.

## Separation of Concerns

- **Library code** → `packages/<pkg>/src/`
- **Tests** → `packages/<pkg>/test/unit/` (the spec `describe` names the source path, e.g. `describe('src/caller/dispatch', ...)`)
- **Build / bundling** → `packages/<pkg>/tsdown.config.ts`; orchestration → `nx.json`
- **Lint / style / commit rules** → shared `@tada5hi/*` configs, thinly wrapped by the root config files
- **CI, release, dependency updates** → `.github/`
