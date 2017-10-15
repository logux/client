# Change Log
This project adheres to [Semantic Versioning](http://semver.org/).

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
