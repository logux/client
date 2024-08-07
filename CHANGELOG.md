# Change Log
This project adheres to [Semantic Versioning](http://semver.org/).

## 0.21.1
* Fixed types.

## 0.21.0
* Added `loadValue()`.
* Added `ensureLoaded()` helper for tests.
* Added `connect` argument to `Client#start`.
* Added key support in `encryptActions` (by @nichoth).
* Added Nano Stores 0.10 support.
* Added `SyncMapStore#deleted`.
* Added `LoadedValue` type to exports.
* Fixed support of local `SyncMap`.
* Removed Node.js 16 support.

## 0.20.1
* Fixed double subscription on `createFilter` (by Eduard Aksamitov).

## 0.20
* Moved to Nano Stores 0.9.
* Refactored Vue composables to improve performance (by Eduard Aksamitov).
* Fixed loss of unsubscribes on changing arguments in Vue (by Eduard Aksamitov).
* Fixed errors handler in Vue (by Eduard Aksamitov).

## 0.19
* Removed Node.js 14 support.
* Moved to Nano Stores 0.8.
* Faster leader election with Web Lock API.

## 0.18.4
* Fixed types (by Slava Mostovoy).

## 0.18.3
* Fixed Nano Stores peer dependency.

## 0.18.2
* Fixed `subscribe.since` for single offline `SyncMap` (by Nikita Galaiko).
* Moved to Nano Stores 0.7.

## 0.18.1
* Fixed `subscribe.since` for offline `SyncMap` (by Nikita Galaiko).

## 0.18
* Moved to Logux Core 0.8.

## 0.17
* Moved to Nano Stores 0.6.

## 0.16
* Removed Node.js 12 support.
* Add `logux/unsubscribe` processing in offline.
* Fixed race condition on resubscribe on `sending` state (by Tyler Han).

## 0.15.3
* Fixed React types (by Wojciech Grzebieniowski).

## 0.15.2
* Cleaned peer dependencies (by Yuri Mikhin).

## 0.15.1
* Fixed value object mutation in `createSyncMap` and `buildSyncMap`.
* Fixed `ErrorsContext` export.

## 0.15
* Added `Client#type(actionCreator, cb)` support.
* Added color highlight for new action and  `logux/undo` events in `log()`.

## 0.14.7
* Moved to new default version of Vue 3 (by Eduard Aksamitov).

## 0.14.6
* Fixed missing store updates in React and Preact (by Aleksandr Slepchenkov).

## 0.14.5
* Fixed Vue `useFilter()` working with reactive filter (by Eduard Aksamitov).
* Improved Vue `useFilter()` performance (by Eduard Aksamitov).
* Improved Vue `useSync()` performance (by Eduard Aksamitov).

## 0.14.4
* Fixed logger for clean events (by Aleksandr Slepchenkov).
* Updated `@nanostores/vue`.

## 0.14.3
* Updated `@nanostores/vue`.

## 0.14.2
* Moved to Nano Stores Vue 0.2 (by Eduard Aksamitov).

## 0.14.1
* Reduced package size.

## 0.14
* Renamed `defineSyncMap()` to `syncMapTemplate()`.
* Moved to Nano Stores 0.5.
* Added `AuthStore#loading` (by Eduard Aksamitov).

## 0.13.3
* Replaced `colorette` with `nanocolors`.

## 0.13.2
* Throw an error on missed client in `useClient()` (by Aleksandr Slepchenkov).

## 0.13.1
* Fixed Preact export (by Phil Schaffarzyk).

## 0.13
* Moved to Nano Stores 0.4.
* Added Nano Stores effects to `SyncMap` and `Filter`.

## 0.12.1
* Moved to React own batching.
* Fixed `useAuth()`.

## 0.12
* Moved from `@logux/state` to `nanostores`.
* Added Preact support.
* Added `filter` support to `TestServer` (by Aleksandr Slepchenkov).
* Fixed docs (by Eduard Aksamitov).

## 0.11.1
* Added `badge/styles` export (by @TrentWest7190).

## 0.11
* Added `@logux/state` peer dependency.
* Added `SyncMap`.
* Added `Filter`.
* Added `prepareForTest` for `SyncMap`.
* Added React helpers for `SyncMap`.
* Added Vue.js helpers for `SyncMap` (by Eduard Aksamitov).
* Fixed `TestServer` error text (by Aleksandr Slepchenkov).

## 0.10
* Moved project to ESM-only type. Applications must use ESM too.
* Dropped Node.js 10 support.
* Added `Client#sync()`.
* Added `track()`.
* Added `Client#type()`.
* Added action encryption.
* Added `request()`.
* Added `TestServer#sendAll()`.
* Added `logux/subscribed` support to `log()`.
* Fixed `IndexedStore` with `Promise`.
* Fixed `TextClient#sent` by adding small delay.
* Fixed types performance by replacing `type` to `interface`.

## 0.9.3
* Fix `changeUser()` for cross-tab client case (by Sergey Korolev).

## 0.9.2
* Fix log messages (by Eduard Aksamitov).
* Replace `chalk` with `colorette`.

## 0.9.1
* Improve log messages for subscribing.

## 0.9
* Use Logux Core 0.6 and WebSocket Protocol 4.
* Add `CrossTabClient#waitFor()`.
* Add `user` event.
* Improve `log()` output with collapsed groups.
* Show offline in the badge from the beginning.
* Fix `Client#changeUser()`.

## 0.8.5
* Remove `global` from `IndexedStore` (by Neville Franks).

## 0.8.4
* Fix `log()` for `logux/unsubscribe` actions.

## 0.8.3
* Update log’s node ID on `Client#changeUser()` call.

## 0.8.2
* Remove support of old servers.

## 0.8.1
* Fix node ID generation in `Client#changeUser()`.

## 0.8
* Use Logux Core 0.5 and WebSocket Protocol 3.
* Rename `credentials` option to `token`.
* User ID must be always a string without `:`.
* Token must be a string.
* Add `Client#changeUser()` method.
* Add support for dynamic tokens.

## 0.7
* Add ES modules support.
* Add TypeScript definitions.
* Move API docs from JSDoc to TypeDoc.
* Mark package as side effect free.

## 0.6
* Do not synchronize event cleaning between tabs.
* Ask to update page receiving bigger `subprocol` from another tab.
* Disable cross-tab communication on `localStorage` error.
* Fix falling on empty `userId` (by @Abdubek).

## 0.5.2
* Fix React Native and React Server-Side Rendering support (by Can Rau).

## 0.5.1
* Fix compatibility with Logux Server 0.4.

## 0.5
* Rename `Client#id` to `Client#tabId`.
* Trim re-send meta keys (`users`, `channels`) during synchronization.

## 0.4
* Add `Client#on` method to unify API with `CrossTabClient`.
* Add `preadd` event as alias to `client.log.on('preadd', cb)`.
* Improve docs (by Paul Chavard).

## 0.3.4
* Fix multiple resubscriptions.

## 0.3.3
* Fix log message for `logux/processed` or `logux/undo`.

## 0.3.2
* Keep `sync: true` actions in the log until `logux/processed` or `logux/undo`.
* Add resubscribe action only after origin action was processed.

## 0.3.1
* Update dependencies.

## 0.3
* Rename project from `logux-client` to `@logux/client`.
* Merge with `logux-status`.
* Use `MemoryStore` by default.
* Use Logux Core 0.3.
* Wait for `logux/processed` before switching to `synchronized` state.
* Add `Client#clientId`.
* Add `action.since` to `logux/subscribe` action.
* Add `ignoreActions` to `log()`.
* Combine add/clean messages in `log()`.
* Remove Promise fix for old Firefox.
* Track subscription counts.
* Clean up code (by Dimitri Nicolas).

## 0.2.10
* Fix cross-tab `add` event with `MemoryStore`.

## 0.2.9
* Fix `MemoryStore` support in cross-tab client.

## 0.2.8
* Fix subscription after offline.

## 0.2.7
* Allow to work with missed `extra.lastSynced`.

## 0.2.6
* Fix `logux/unsubscribe` detection.
* Subscribe again only in `connected` state.
* Allow to have `:` in user ID.
* Allow to use client without `window`.

## 0.2.5
* Fix follower tab’s actions synchronization.

## 0.2.4
* Fix `Promise` implementation in `IndexedStore`.

## 0.2.3
* Fix `IndexedStore` in Firefox.

## 0.2.2
* Fix subscription to same channel twice.

## 0.2.1
* Sort correctly actions with same `time`.
* Fix race condition between uniqueness check and add.

## 0.2
* Use Logux Protocol 2.
* Use Logux Core 0.2 and Logux Sync 0.2.
* Send actions with `meta.sync` only.
* Add `logux/subscribe` and `logux/unsubscribe` support.
* Replace `localStorage` to `IndexedDB` in the store (by Alexey Gaziev).
* Add mandatory `userId` option.
* Use Nano ID for node ID.
* Add cross-tab communication with leader tab election.
* Add `meta.tab` support.
* Add `debug` message support (by Roman Fursov).
* Add production non-secure protocol warning (by Hanna Stoliar).
* Add `Add Client#clean` method.
* Set `meta.subprotocol`.
* Move store tests to separated project (by Konstantin Mamaev).
* Fix docs (by Grigoriy Beziuk and Vladimir Dementyev).
* Clean up code (by Evgeny Rodionov).

## 0.1
* Initial release.
