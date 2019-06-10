# Change Log
This project adheres to [Semantic Versioning](http://semver.org/).

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
