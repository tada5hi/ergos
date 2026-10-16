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
│   │   │   ├── component/               # IComponent, ICallable, IScheduledComponent, Component, defineScheduledComponent
│   │   │   ├── dispatcher/              # IDispatcher + LocalDispatcher / RemoteDispatcher, internal wire codec
│   │   │   ├── worker/                  # RemoteWorker, internal lifecycle helper
│   │   │   ├── message-bus/             # IMessageBus, MessageBus, IMessageBusDriver, MemoryMessageBusDriver, message helpers
│   │   │   └── conformance/             # `synergos/conformance` subpath: defineDriverConformance (not in index.ts)
│   │   ├── test/
│   │   │   ├── unit/*.spec.ts           # One spec per module
│   │   │   ├── unit/fakes/              # TestComponent, FakeMessageBus, drain()
│   │   │   └── vitest.config.ts
│   │   ├── package.json, README.md, LICENSE
│   │   ├── tsconfig.json                # src + test (paths-mapped), used by `typecheck`
│   │   ├── tsconfig.build.json          # src only, resolved through node_modules; used by `build:types`
│   │   └── tsdown.config.ts             # esm, dts, sourcemap; entries index + conformance
│   └── amqp/                            # package `@synergos/amqp`
│       ├── src/                         # AmqpMessageBusDriver, IAmqpClient, hook/event types
│       ├── test/
│       │   ├── unit/driver.spec.ts
│       │   ├── unit/fakes/amqp-client.ts  # FakeAmqpClient; .loopback() delivers publishes to consumers
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
| `synergos/src/component/scheduled.ts` | `defineScheduledComponent`: cron expression validated at definition, first pass on start, node-cron schedule with `noOverlap`, a failed pass → `hooks.onError`; `stop()` never waits for a pass (a pass may stop its own component), stop-during-start never schedules, the task is destroyed; returns an `IScheduledComponent` whose `settled()` resolves once no pass runs (a shutdown awaits it after `stop()`; a pass must never await its own) |
| `synergos/src/dispatcher/` | `IDispatcher` → `{ correlationId }`. `LocalDispatcher` (in-process, returns forwarded events as `replies`, optional `reply` component, no lifecycle), `RemoteDispatcher` (publishes a command; a rejected publish rejects `dispatch()`; no hooks) |
| `synergos/src/dispatcher/wire.ts` | Internal (not exported): `correlate`, `toMessage` (drops a caller's `delivery`, a legacy body `attempt` and `timestamp`, overwrites `routing` in place), `fromMessage` (the only wire cast), `toForwardedMessage` (also drops `persistent` and `expiresAt`). Used by the dispatchers and `RemoteWorker` |
| `synergos/src/worker/` | `RemoteWorker`: consumes a routing into an `ICallable`, publishes forwarded events (replies and unhandled commands) to `publish`, else `onUnrouted`; a rejected publish fails the command. Itself an `IComponent` on the internal `worker/lifecycle.ts` (`createLifecycle(acquire)`: a `start()` joins one in flight, a `stop()` waits for it and releases, calls during a release queue in call order so the last one wins, a failed `start()` or release can be retried) |
| `synergos/src/message-bus/` | `IMessageBus` + `MessageBus` (type dispatch with `'*'` fallback; `onPublish` / `onConsume` / `onUnhandled` / `onExpired` / `onError` hooks; an expired `metadata.expiresAt` is acked without a handler; `close()` → driver), `IMessageBusDriver` / `IMessageBusConsumer` (the delivery contract: `publish()` resolves `void` on hand-off, never waits for or sees a handler; `close()` required; `metadata.delivery` on consume), `MemoryMessageBusDriver` (delivers on a microtask, swallows handler errors; WORK (per namespace and key) = a queue that keeps messages until consumed, round-robin, `ordered` → first consumer, one handler at a time; a PUB_SUB `queue` = such a queue per name (from its first consume; `publish()` ignores `queue`), one copy each; any other PUB_SUB fan-out and drop; `cancel()` awaits in-flight handlers; `consume()` / `publish()` reject after `close()`; `delivery` 1/1), `buildMessage` / `isMessage` / `serializeMessage` |
| `synergos/src/conformance/` | `defineDriverConformance({ describe, it }, createDriver)`: the driver contract as cases on `node:assert`, shipped as the `synergos/conformance` subpath (own tsdown entry + `exports` entry). No vitest import |
| `synergos/src/hook/` | `invokeHook(hooks, name, ...args)`: calls a hook with `hooks` as `this` and ignores a throw or a rejected promise |
| `amqp/src/` | `AmqpMessageBusDriver`: routing → exchange/queue options, publish properties (`persistent`: `metadata.persistent` ?? `routing.persistent` ?? WORK; `expiresAt` → `expiration`), decode + guard (`onMalformed`), `metadata.delivery` (WORK and a PUB_SUB `queue`: `x-attempt` + `maxAttempts`; plain PUB_SUB: 1/1), a PUB_SUB `queue` → amqp-extension's consume `queue` (durable, shared, retried; the publisher declares no queue); a namespaced WORK → topic exchange `namespace` + consume `queue: key` (amqp-extension treats every direct exchange as the default one), retry/drop reporting (`onRetry` / `onDrop`); retry and the redelivery guard are amqp-extension's |

## Hooks

Every observable event is an optional, typed hook on the class's `hooks` option; the hook
types sit in the module's `types.ts` (`MessageBusHooks`,
`RemoteWorkerHooks`, `ScheduledComponentHooks`, `AmqpMessageBusDriverHooks`). Call them only
through `invokeHook`: hooks observe and must never change an outcome — every hook site can sit
on a consume path, where a propagated error would turn an ack into a retry.

## Key Dependencies

- `synergos`: `node-cron` (scheduled components), its only runtime dependency. It never imports amqp-extension.
- `@synergos/amqp`: `amqp-extension` (`^5.1.1`, dependency) and `synergos` (peer + dev, workspace version; release-please's node-workspace plugin bumps the range).

## Package Exports

Both packages publish only `dist/` (plus README/LICENSE) with a `.` export; `synergos` adds
`./conformance` (`dist/conformance.mjs` / `.d.mts`, tsdown entry `conformance`):

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
- `src/index.ts` is each package's public surface (plus `synergos`' `src/conformance/index.ts`): a symbol not exported there is internal.
- After changing an `exports` map, verify by hand: `npm run build`, then
  `node --input-type=module -e "await import('./packages/<pkg>/dist/index.mjs')"` (and
  `dist/conformance.mjs` for synergos) and
  `npm pack --dry-run -w packages/<pkg>`.

## Separation of Concerns

- **Library code** → `packages/<pkg>/src/`
- **Tests** → `packages/<pkg>/test/unit/` (the spec `describe` names the source path, e.g. `describe('src/dispatcher/remote', ...)`)
- **Build / bundling** → `packages/<pkg>/tsdown.config.ts`; orchestration → `nx.json`
- **Lint / style / commit rules** → shared `@tada5hi/*` configs, thinly wrapped by the root config files
- **CI, release, dependency updates** → `.github/`
