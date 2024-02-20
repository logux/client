# Logux Client [![Cult Of Martians][cult-img]][cult]

<img align="right" width="95" height="148" title="Logux logotype"
     src="https://logux.org/branding/logotype.svg">

Logux is a new way to connect client and server. Instead of sending
HTTP requests (e.g., AJAX and GraphQL) it synchronizes log of operations
between client, server, and other clients.

* **[Guide, recipes, and API](https://logux.org/)**
* **[Issues](https://github.com/logux/logux/issues)**
  and **[roadmap](https://github.com/orgs/logux/projects/1)**
* **[Projects](https://logux.org/guide/architecture/parts/)**
  inside Logux ecosystem

This repository contains Logux base components to build web client:

* `CrossTabClient` and `Client` to create web client for Logux.
* `IndexedStore` to store Logux log in `IndexedDB`.
* `badge()` widget to show Logux synchronization status in UI.
* `status()` to write own UI to show Logux synchronization status in UI.
* `attention()`, `confirm()`, `favicon()` to improve UX in Logux web app.
* `log()` to print Logux synchronization status to browser DevTools.

Check **[demo page]** for widget UI.

[demo page]: https://logux.github.io/client/
[cult-img]: http://cultofmartians.com/assets/badges/badge.svg
[cult]: http://cultofmartians.com/done.html

---

<img src="https://cdn.evilmartians.com/badges/logo-no-label.svg" alt="" width="22" height="16" />  Made in <b><a href="https://evilmartians.com/devtools?utm_source=logux-client&utm_campaign=devtools-button&utm_medium=github">Evil Martians</a></b>, product consulting for <b>developer tools</b>.

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
  subprotocol: '1.0.0',
  server: 'wss://example.com:1337',
  userId,
  token
})

badge(client, { messages: badgeEn, styles: badgeStyles })
log(client)

client.start()
```

[documentation]: https://github.com/logux/logux
