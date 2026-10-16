# Changelog

## 0.1.0 (2026-10-16)


### ⚠ BREAKING CHANGES

* rename the packages to synergos and @synergos/amqp
* publish the amqp driver as ergos-amqp
* ILogger, the logger options, the logging publish option, MessageBusPublishOptions and ScheduledComponentOptions.name are removed; pass hooks instead.
* every renamed symbol above; consume() handlers use '*'.
* import the AMQP driver from `@ergos/amqp` instead of `ergos/amqp`.

### Features

* hand a work handler its delivery attempt in metadata.attempt ([#11](https://github.com/tada5hi/synergos/issues/11)) ([6692a53](https://github.com/tada5hi/synergos/commit/6692a532842c7351c634da8acde9a468fb8646ca))


### Bug Fixes

* **amqp:** require amqp-extension 5.1.1 ([#8](https://github.com/tada5hi/synergos/issues/8)) ([be13ec5](https://github.com/tada5hi/synergos/commit/be13ec53021cb49c18a07e23173d6e2f87975fa0))


### Code Refactoring

* rename the message and caller vocabulary ([4e5b677](https://github.com/tada5hi/synergos/commit/4e5b67775f680909d1d70ea1329d9fcdbee0e6f7))
* replace logger options with typed hooks ([150436e](https://github.com/tada5hi/synergos/commit/150436e3b4bd7fefdef87c94677718948b998f8d))


### Build System

* publish the amqp driver as ergos-amqp ([085dbe5](https://github.com/tada5hi/synergos/commit/085dbe52647b8568ad974457c7fdf29685abba53))
* rename the packages to synergos and @synergos/amqp ([7549561](https://github.com/tada5hi/synergos/commit/75495616208206f5a9beb277cbef3d5e56b04828))
* split into an npm workspaces monorepo (ergos, @ergos/amqp) ([8b0b6d7](https://github.com/tada5hi/synergos/commit/8b0b6d772c526b4b16652d5e6a69831f8abe5cf2))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * synergos bumped from ^0.0.0 to ^0.1.0
  * peerDependencies
    * synergos bumped from ^0.0.0 to ^0.1.0
