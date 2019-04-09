# Logux Client [![Cult Of Martians][cult-img]][cult]

<img align="right" width="95" height="95" title="Logux logo"
     src="https://cdn.rawgit.com/logux/logux/master/logo.svg">

Logux is a new way to connect client and server. Instead of sending
HTTP requests (e.g., AJAX and GraphQL) it synchronizes log of operations
between client, server, and other clients.

**Documentation: [logux/logux]**

This repository contains Logux core components for JavaScript:

* `CrossTabClient` and `Client` to create web client for Logux.
* `IndexedStore` to store Logux log in `IndexedDB`.
* `badge` widget to show Logux synchronization status in UI.
* `status()` to write own UI to show Logux synchronization status in UI.
* `attention()`, `confirm()`, `favicon()` to improve UX in Logux web app.
* `log()` to print Logux synchronization status to browser DevTools.

Check **[demo page]** for widget UI.

<a href="https://evilmartians.com/?utm_source=logux-client">
  <img src="https://evilmartians.com/badges/sponsored-by-evil-martians.svg"
       alt="Sponsored by Evil Martians" width="236" height="54">
</a>

[logux/logux]: https://github.com/logux/logux
[demo page]: https://logux.github.io/client/
[cult-img]: http://cultofmartians.com/assets/badges/badge.svg
[cult]: http://cultofmartians.com/done.html


## Install

```sh
npm install @logux/client
```


## Usage

See [documentation] for Logux API.

```js
import CrossTabClient from '@logux/client/cross-tab-client'
import messages from 'logux-client/badge/en'
import styles from 'logux-client/badge/default'
import badge from 'logux-client/badge'
import log from '@logux/client/log'

let userId = document.querySelector('meta[name=user-id]').content
let userToken = document.querySelector('meta[name=user-token]').content

const client = new CrossTabClient({
  credentials: userToken,
  subprotocol: '1.0.0',
  server: 'wss://example.com:1337',
  userId: userToken
})

badge(client, { messages, styles })
log(client)

client.start()
```

[documentation]: https://github.com/logux/logux
