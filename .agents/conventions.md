# Conventions

## Tooling

| Tool                          | Purpose                                                                       |
|-------------------------------|-------------------------------------------------------------------------------|
| npm workspaces + nx           | `packages/*`; root scripts run `nx run-many -t <target>` across packages       |
| tsdown                        | Bundles each package's `src/index.ts` → `dist/` (ESM + `.d.mts` + sourcemaps)  |
| TypeScript                    | Type checking only (`noEmit: true`); base config from `@tada5hi/tsconfig`      |
| ESLint (flat config)          | One root config via `@tada5hi/eslint-config`; `**/dist/**`, `**/coverage/**` ignored |
| Vitest                        | Test runner and v8 coverage — see [testing](testing.md)                        |
| commitlint                    | Conventional Commits enforcement via `@tada5hi/commitlint-config`              |
| husky                         | Sets `core.hooksPath`; installed by the `prepare` script                       |
| release-please                | Version bump, changelog, and release PR on `master`                            |
| Dependabot                    | Daily npm + GitHub Actions updates, grouped by prod/dev × major/minor+patch    |
| EditorConfig                  | Whitespace rules shared with the editor                                        |

The three `@tada5hi/*` config packages are the source of truth for style, TS, and commit rules. The local config files are thin wrappers — **change the shared package, not the local override**, unless the deviation is genuinely project-specific.

## Workflow

- After making changes, **always run `npm run build`, `npm run typecheck` and `npm run lint`** (from the root), plus `npm run test` when behavior changed.
- `npm run lint:fix` auto-fixes most style violations — run it before hand-editing formatting.
- Never edit `dist/` — it is generated and git-ignored.
- Never hand-edit `.release-please-manifest.json` or the versions in `packages/*/package.json`; release-please owns them.
- `node-cron` is the only runtime dependency of `hubwire`; it must never depend on amqp-extension. Transport-specific code goes in its own package (`@hubwire/amqp`), which takes its transport as a real dependency and `hubwire` as a peer + dev dependency at the workspace version. Shared tooling belongs in the root `devDependencies`.
- Regenerate `package-lock.json` with a plain `npm install` — never `--package-lock-only` (drops other platforms' optional dependencies) or `--force`.
- Contracts carry an `I` prefix and live in `types.ts`; classes `implements` them, and dependents take the contract (`IMessageBus`), not the class. No `as any`; a cast only where nothing can check the type (`fromMessage` in `dispatcher/wire.ts`, the wire boundary).
- No logger: observable events are optional typed hooks on a `hooks` option (`on*`), declared in `types.ts` and called through `invokeHook`, which ignores a hook that throws or rejects. A hook must never change an outcome (ack vs. retry, resolve vs. reject).

## Code Style

- **Module format**: ESM only (`"type": "module"`). Use `import`/`export`; no `require`, no `__dirname`.
- **Indentation**: 4 spaces (`.editorconfig`), including JSON, YAML, and TS.
- **Line endings**: LF; UTF-8; trailing whitespace trimmed; final newline required (except in Markdown, where trailing whitespace is preserved).
- **Semicolons**: required; **quotes**: single — both enforced by `@tada5hi/eslint-config`.
- **Linting**: one flat config at the root (`eslint.config.js`), spreading `await config()` from `@tada5hi/eslint-config`.

## File Organization

- Each package's `src/index.ts` is its public barrel. Anything not re-exported from it is internal and never published.
- Add new implementation modules under `packages/<pkg>/src/` as `kebab-case` directories/files and re-export them from `index.ts`.
- Exported types (interfaces, type aliases) belong in a `types.ts` next to the implementation, re-exported through the nearest barrel.
- Tests mirror the `src/` path under `test/unit/` — see [testing](testing.md).

## Pre-commit Hooks

`core.hooksPath` points at `.husky/`, and `npm run prepare` (via `husky`) sets it up on install. **No hook scripts are committed** — `.husky/_/` is git-ignored and the repo tracks no hook files, so nothing runs on commit today.

commitlint is configured but not wired to a hook. If you want local enforcement, add `.husky/commit-msg`:

```bash
npx --no -- commitlint --edit "$1"
```

Until then, commit message format is the author's (and the agent's) responsibility.

## Commit Convention

Commits follow **[Conventional Commits](https://www.conventionalcommits.org)** — release-please parses them to compute the next version and generate the changelog.

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

- The packages stay below 1.0.0 until the API is stable. While pre-1.0: `fix:` and `feat:` → patch bump (`bump-patch-for-minor-pre-major`), `!` or a `BREAKING CHANGE:` footer → minor bump (`bump-minor-pre-major`). The first release is `0.1.0` (`initial-version`).
- Going 1.0: land a commit with a `Release-As: 1.0.0` footer. From then on `fix:` → patch, `feat:` → minor, breaking → major.
- `build:`, `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `test:` → no release.
- Dependabot is configured to use `fix` for production deps and `build` for dev deps, with the scope included — match that when bumping dependencies by hand (e.g. `build(deps-dev): bump vitest to v4`).

## TypeScript

- Root `tsconfig.build.json` extends `@tada5hi/tsconfig`; local overrides: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `noEmit: true`, `allowImportingTsExtensions: true`. Root `tsconfig.json` adds `paths` mapping `hubwire` / `@hubwire/amqp` to their `src`.
- Per package: `tsconfig.build.json` (src only, no paths — resolves siblings through `node_modules`/`dist`, so nx builds `hubwire` first) backs `build:types`; `tsconfig.json` (src + test, paths-mapped) backs `typecheck`.
- `moduleResolution: bundler` means imports are written without file extensions and resolved by tsdown; do not add `.js` extensions to relative imports.
- Declarations are emitted by tsdown (`dts: true`), not by `tsc`.

## Build Output

`npm run build` runs each package's `build:types` (`tsc --noEmit`) then `build:js` (tsdown), which writes `packages/<pkg>/dist/index.mjs`, `index.d.mts` and `index.mjs.map`. `dist/` is git-ignored and, with README and LICENSE, the only thing published to npm. In `@hubwire/amqp`'s bundle, `hubwire` and `amqp-extension` stay external imports.

## Release Process

Automated by `.github/workflows/release.yml` on every push to `master`:

1. **release-please** (`googleapis/release-please-action@v5`, monorepo mode) opens or updates a release PR that bumps each changed package's version, updates its `CHANGELOG.md`, and syncs `.release-please-manifest.json`. The `node-workspace` plugin (`updatePeerDependencies: true`) bumps `@hubwire/amqp`'s `hubwire` range along with it.
2. Merging that PR creates one git tag per released package (component-prefixed, e.g. `hubwire-v0.1.0`, `amqp-v0.1.0`) and GitHub releases.
3. On that same run, `releases_created == 'true'` gates checkout → install → build → **publish** via `tada5hi/monoship@v2`, which publishes every workspace package whose version is not yet on npm.

Config lives in `release-please-config.json` (`release-type: node`, `bump-minor-pre-major: true`, `bump-patch-for-minor-pre-major: true`, `initial-version: 0.1.0`, `packages: { packages/hubwire, packages/amqp }`). Releases are never cut by hand.

## CI/CD

- `.github/workflows/main.yml` — CI on push/PR to `develop`, `master`, `next`, `beta`, `alpha`: install → build → lint + typecheck + test in parallel. Node 24, concurrency group cancels superseded runs.
- `.github/workflows/release.yml` — release-please + npm publish on `master`.
- Both reuse the composite actions in `.github/actions/` (`install`, `build`) — change caching or the Node setup there, once, rather than per workflow.
- `PRIMARY_NODE_VERSION` is pinned to `24` in each workflow's `env` block; the packages only require `>=22`.

## Best Practices

- Use **ESM** and modern TypeScript/JavaScript; target ES2022 features freely.
- Before adding new code, study the surrounding patterns, naming, and structure, and stay consistent with them.
- Resist hub- or authup-specific policy (DI modules, health aggregation, exchange names): it stays in the consuming app.
- Prefer upgrading a shared `@tada5hi/*` config over adding a local rule override.
