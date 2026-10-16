# Changelog

## 0.1.0 (2026-10-16)


### ⚠ BREAKING CHANGES

* install hubwire, @hubwire/amqp and @hubwire/test.
* install busline instead of synergos, @busline/amqp instead of @synergos/amqp.
* publish() resolves void instead of a boolean; DispatchResult.delivered, RemoteDispatcherHooks (onUndelivered) and RemoteWorkerHooks.onUndelivered are removed; metadata.attempt is replaced by metadata.delivery; IMessageBusDriver.close() is required and the memory driver no longer awaits handlers in publish().

### Features

* one delivery contract for every message bus driver, plus delivery info, expiry, durable subscriptions and draining scheduled passes ([#20](https://github.com/tada5hi/hubwire/issues/20)) ([1aa7c1f](https://github.com/tada5hi/hubwire/commit/1aa7c1f402447b55cd5e5fbe0e91fdc2530af86e))
* rename busline to hubwire ([36687bd](https://github.com/tada5hi/hubwire/commit/36687bd111fc5d8df45e302f97a7c685d5836a53))
* rename synergos to busline ([1cf6aaa](https://github.com/tada5hi/hubwire/commit/1cf6aaa5727800071c6188e6fac0f1f9a33e117d))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * hubwire bumped from ^0.1.0 to ^0.2.0
  * peerDependencies
    * hubwire bumped from ^0.1.0 to ^0.2.0
