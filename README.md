# Logux Client

<img align="right" width="95" height="148" title="Logux logotype"
     src="https://logux.org/branding/logotype.svg">

Logux is a new way to connect client and server. Instead of sending
HTTP requests (e.g., AJAX and GraphQL) it synchronizes log of operations
between client, server, and other clients.

- **[Guide, recipes, and API](https://logux.org/)**
- **[Issues](https://github.com/logux/logux/issues)**
  and **[roadmap](https://github.com/orgs/logux/projects/1)**
- **[Projects](https://logux.org/guide/architecture/parts/)**
  inside Logux ecosystem

This repository contains Logux base components to build web client:

- `CrossTabClient` and `Client` to create web client for Logux.
- `IndexedStore` to store Logux log in `IndexedDB`.
- `badge()` widget to show Logux synchronization status in UI.
- `status()` to write own UI to show Logux synchronization status in UI.
- `attention()`, `confirm()`, `favicon()` to improve UX in Logux web app.
- `log()` to print Logux synchronization status to browser DevTools.

Check **[demo page]** for widget UI.

[demo page]: https://logux.github.io/client/

---

<img src="https://cdn.evilmartians.com/badges/logo-no-label.svg" alt="" width="22" height="16" />  Logux Client is built by <b><a href="https://evilmartians.com/">Evil Martians</a></b>, an American design and engineering consultancy for <b>developer tools, AI, and cybersecurity startups</b>.

---

## Install

```sh
npm install @logux/core @logux/client nanostores
```

## Usage

See [documentation] for Logux API.

```js
import { CrossTabClient, badge, badgeEn, log } from '@logux/client'
import { badgeStyles } from '@logux/client/badge/styles'

let userId = document.querySelector('meta[name=user]').content
let token = document.querySelector('meta[name=token]').content

const client = new CrossTabClient({
  subprotocol: 1,
  server: 'wss://example.com:1337',
  userId,
  token
})

badge(client, { messages: badgeEn, styles: badgeStyles })
log(client)

client.start()
```

## SQL Tables

`@logux/client/db` keeps CRDT tables in a local SQL database
(like SQLite in the browser) filled from Logux log. All changes are
synchronized as Logux actions, and edit conflicts are resolved with
per-field last write wins.

It needs [Nano Stores SQL] database:

```sh
npm install @nanostores/sql
```

```js
import { openDb } from '@nanostores/sql'
import { sqlocalDriver } from '@nanostores/sql/sqlocal'
import {
  bigint,
  createCrdtDatabase,
  number,
  optional,
  string
} from '@logux/client/db'

let db = openDb(sqlocalDriver('app.sqlite'))
let crdt = createCrdtDatabase(client, db, {
  async repeat() {
    // Ask server to the full client log
    // Remove if you store the whole lo locally
  }
})

let user = crdt.table('user', {
  age: optional(number()),
  createdAt: bigint({ default: () => Date.now() }),
  name: string()
})

let id = await user.create({ name: 'Ann' })
await user.update(id, { age: 30 })

let $adults = user.select`WHERE "age" >= ${18} ORDER BY "name"`
```

[Nano Stores SQL]: https://github.com/nanostores/sql

## End-to-End Encryption

`encryptActions()` encrypts actions before sending them to the server,
so the server can’t read users’ data. Pass a password or an AES
`CryptoKey` and list action types to be kept unencrypted.

```js
import { encryptActions } from '@logux/client'

encryptActions(client, localStorage.getItem('userPassword'), {
  ignore: ['server/public']
})
```

[documentation]: https://github.com/logux/logux
