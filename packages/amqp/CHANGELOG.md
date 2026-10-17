# Changelog

## [0.2.2](https://github.com/tada5hi/hubwire/compare/amqp-v0.2.1...amqp-v0.2.2) (2026-10-17)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @hubwire/test bumped from ^0.1.1 to ^0.1.2
    * hubwire bumped from ^0.2.1 to ^0.2.2
  * peerDependencies
    * hubwire bumped from ^0.2.1 to ^0.2.2

## [0.2.1](https://github.com/tada5hi/hubwire/compare/amqp-v0.2.0...amqp-v0.2.1) (2026-10-16)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @hubwire/test bumped from ^0.1.0 to ^0.1.1
    * hubwire bumped from ^0.2.0 to ^0.2.1
  * peerDependencies
    * hubwire bumped from ^0.2.0 to ^0.2.1

## [0.2.0](https://github.com/tada5hi/hubwire/compare/amqp-v0.1.0...amqp-v0.2.0) (2026-10-16)


### ⚠ BREAKING CHANGES

* install hubwire, @hubwire/amqp and @hubwire/test.
* install busline instead of synergos, @busline/amqp instead of @synergos/amqp.
* publish() resolves void instead of a boolean; DispatchResult.delivered, RemoteDispatcherHooks (onUndelivered) and RemoteWorkerHooks.onUndelivered are removed; metadata.attempt is replaced by metadata.delivery; IMessageBusDriver.close() is required and the memory driver no longer awaits handlers in publish().
* DirectCaller, DispatchCaller, WorkerCaller, ICaller and their option/hook types are removed; see the README for the migration.

### Features

* one delivery contract for every message bus driver, plus delivery info, expiry, durable subscriptions and draining scheduled passes ([#20](https://github.com/tada5hi/hubwire/issues/20)) ([1aa7c1f](https://github.com/tada5hi/hubwire/commit/1aa7c1f402447b55cd5e5fbe0e91fdc2530af86e))
* rename busline to hubwire ([36687bd](https://github.com/tada5hi/hubwire/commit/36687bd111fc5d8df45e302f97a7c685d5836a53))
* rename synergos to busline ([1cf6aaa](https://github.com/tada5hi/hubwire/commit/1cf6aaa5727800071c6188e6fac0f1f9a33e117d))
* replace the callers with LocalDispatcher, RemoteDispatcher and RemoteWorker ([#15](https://github.com/tada5hi/hubwire/issues/15)) ([1e1acce](https://github.com/tada5hi/hubwire/commit/1e1acce152e2b5c378f2bae467f7db15ee20c97a))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @hubwire/test bumped from ^0.0.0 to ^0.1.0
    * hubwire bumped from ^0.1.0 to ^0.2.0
  * peerDependencies
    * hubwire bumped from ^0.1.0 to ^0.2.0

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
