# Logux Client

Logux is a client-server communication protocol. It synchronizes events
between clients and server logs.

This 6 KB library allows to put a events (like “actions” in Redux)
to local log and synchronize them with [Logux server]
and then to all other online clients.

This is low-level client API. Redux-like API will be soon.
It will be better for most of developers.

[Logux server]: https://github.com/logux/logux-server

<a href="https://evilmartians.com/?utm_source=logux-client">
  <img src="https://evilmartians.com/badges/sponsored-by-evil-martians.svg"
       alt="Sponsored by Evil Martians" width="236" height="54">
</a>

## Getting Started

### Add Logux to Project

This project use npm package manager. So your need webpack or Browserify
to build single JS bundle for browsers.

Install Logux Client:

```js
npm install --save logux-client
```

### Add Credentials to Client

You should use secret token to authenticate current user in Logux server.

We suggest to add special `token` column to users table and fill it
with random strings.

When user will ask `index.html` from your app, HTTP server could add
`<meta>` tags with token and Logux server URL.

```html
<meta name="token" content="<%= user.token %>" />
<meta name="server" content="wss://example.com:1337" />
```

It is not the only way. You could also use cookies or tools like [Gon].

[Gon]: https://github.com/gazay/gon

### Create Logux Client

Create Logux Client instance in client-side JS, `onready` event is good time
for it.

```js
var Client = require('logux-client/client')

var server = document.querySelector('meta[name=server]')
var token = document.querySelector('meta[name=token]')

var logux = new Client({
  credentials: token.content,
  subprotocol: '1.0.0',
  url: server.content
})
logux.sync.connection.connect()
```

### Process Events

Add callbacks when new events will come to client log
(from server, other clients or local `logux.log.add` call):

```js
logux.log.on('event', function (event, meta) {
  if (event.type === 'changeName') {
    var user = document.querySelector('.user[data-id=' + event.user + ']')
    if (user) {
      document.querySelector(' .user__name').innerText = event.name
    }
  }
})
```

Read [`logux-core`] docs for `logux.log` API.

[`logux-core`]: https://github.com/logux/logux-core

### Create a Events

When you need to send information to server, just add event to log:

```js
submit.addEventListener('click', function () {
  logux.log.add({
    type: 'changeName',
    user: userId.value,
    name: name.value
  })
}, false)
```

### Show Connection State

Notify user, when connection was lost:

```js
var favicon = document.querySelector('link[rel~="icon"]')
var notice  = document.querySelector('.offline-notice')

logux.sync.on('state', function () {
  if (logux.sync.connected) {
    favicon.href = '/favicon.ico'
    notice.classList.add('.offline-notice_hidden')
  } else {
    favicon.href = '/offline.ico'
    notice.classList.remove('.offline-notice_hidden')
  }
})
```

Notify user on page leaving, that some data was not synchronized yet:

```js
window.onbeforeunload = function (e) {
  if (logux.sync.state === 'wait') {
    e.returnValue = 'Edits were not saved'
    return e.returnValue
  }
}
```
