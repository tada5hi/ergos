# Testing

## Setup

- **Runner**: [Vitest](https://vitest.dev)
- **Test location**: per package, `packages/<pkg>/test/unit/**/*.{test,spec}.{js,ts}` — files outside this glob are **not** picked up
- **Config**: `packages/<pkg>/test/vitest.config.ts` (the npm scripts pass `--config` explicitly).
  `@synergos/amqp`'s config aliases `synergos` to `../synergos/src`, so its tests need no prior build.
- **Prerequisite**: `npm ci`. No database, container, or external service is required.

## Running Tests

```bash
npm run test                                  # every package (nx run-many), once
npm run test:coverage                         # every package, with coverage
npm run typecheck                             # tsc --noEmit over src + test, every package
npm run test -w packages/synergos                # one package
cd packages/synergos && npx vitest --config test/vitest.config.ts --run test/unit/hook.spec.ts   # single file
```

The per-package `test` scripts pass `--run`, so they never enter watch mode — safe for CI and for agents.

## Test Layers

### Unit Tests

`test/unit/` holds the only test layer, one spec per module — synergos: `component`, `scheduled`,
`hook`, `message-bus`, `memory-driver`, `local-dispatcher`, `remote-dispatcher`, `remote-worker`;
@synergos/amqp: `driver`. Specs import the package under test from its **source** barrel
(`'../../src'`), not from `dist/`; amqp specs import `synergos` and `synergos/conformance` by name
(aliased to source).

- **Driver conformance.** `synergos/conformance` (`src/conformance/`) holds the driver contract as
  cases (`defineDriverConformance({ describe, it }, createDriver)`, `node:assert`). `memory-driver.spec`
  runs it against `MemoryMessageBusDriver`, `driver.spec` (@synergos/amqp) against
  `AmqpMessageBusDriver` over `FakeAmqpClient.loopback()`. A contract case goes there, not into a
  driver spec; driver specs keep only driver-specific behaviour.
- **Delivery is asynchronous.** `publish()` / `dispatch()` resolve before the handlers ran. Wait
  for a handler with a deferred, or with `drain()` (`test/unit/fakes/drain.ts`, one `setImmediate`:
  the memory driver delivers on microtasks).

- **Fakes, never `vi.fn()` / `vi.mock()`.** Shared fakes live in `test/unit/fakes/`
  (`TestComponent`, `FakeMessageBus` implementing `IMessageBus`, `drain`, `FakeAmqpClient`). The memory
  driver is the bus in most dispatcher and worker specs. Hooks are asserted with plain objects whose hook
  functions push into an array.
- Every hook has a spec that it fires, and each hook site has one that a throwing hook leaves
  the outcome unchanged (resolve vs. reject, ack vs. retry).
- Concurrency is pinned with `Promise.withResolvers()` deferreds where possible.
  `scheduled.spec.ts` uses real node-cron seconds schedules and waits ~1s per case.
- `driver.spec.ts` (@synergos/amqp) runs against `FakeAmqpClient` (no broker) and compares every routing
  shape with `fixtures/hub-wire.ts`, captured from hub's former driver. The only allowed
  difference is the retry counter (body `metadata.attempt` → `x-attempt` header, reported to the
  handler as `metadata.delivery`). Never
  regenerate the fixture from this driver — that would make the comparison vacuous.
- There is no broker-backed (RabbitMQ) integration test; amqp-extension's own suite covers the broker.
- Each package's `tsconfig.json` includes `src/` and `test/` and is what `npm run typecheck` checks
  (CI runs it); `tsconfig.build.json` (src only) is the `build:types` gate.

## Testing Philosophy

Tests should assert *expected* behavior based on the module contract — not merely confirm what the implementation currently does. If a test fails, it may surface a real bug in the implementation rather than a test error.

Prefer real implementations and small fake objects over `vi.fn()` / `vi.mock()`. Module mocking couples tests to import structure and hides breaking changes; a hand-written fake that satisfies the same interface keeps tests honest. Reach for `vi.mock` only for genuinely unavoidable boundaries (clock, filesystem, network).

## Code Coverage

```bash
npm run test:coverage
```

Provider is **v8**, per package, and coverage is measured over `src/**/*.{ts,tsx,js,jsx}` only. Thresholds are enforced — the command **fails** below any of them:

| Metric     | Threshold |
|------------|-----------|
| Branches   | 80%       |
| Functions  | 80%       |
| Lines      | 80%       |
| Statements | 80%       |

Reports land in `coverage/` (git-ignored). The README links a Codecov badge, but no upload step is wired into CI.

## CI Pipeline

GitHub Actions (`.github/workflows/main.yml`) on pushes and PRs to `develop`, `master`, `next`, `beta`, `alpha`:

```
install ──► build ──┬──► lint      (npm run lint)
                    ├──► typecheck (npm run typecheck)
                    └──► tests     (npm run test)
```

Node 24, `npm ci`, with `node_modules` cached by `package-lock.json` hash and every `dist/` cached by commit SHA. Note CI runs `npm run test`, **not** `test:coverage` — coverage thresholds are not gating merges today.

## Writing New Tests

1. Place the file in the package's `test/unit/` with a `.spec.ts` (or `.test.ts`) extension, mirroring the `src/` path it covers.
2. Import the symbol under test from the barrel (`'../../src'`).
3. Name the outer `describe` after the source file and phrase `it` titles as `should ...`.
4. Run `npm run test` to verify, and `npm run test:coverage` if the change could move coverage below 80%.
