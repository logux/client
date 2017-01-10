# Logux Client

<img align="right" width="95" height="95" title="Logux logo"
     src="https://cdn.rawgit.com/logux/logux/master/logo.svg">

Logux is a client-server communication protocol. It synchronizes events
between clients and server logs.

This 6 KB library allows you to put events (which look similar
to Redux “actions”) to a local log and synchronize them with [Logux server]
and thus with every other client being online.

This is a low-level client API. Redux-like API, which is supposed
to be more suitable for most of developers, is coming soon.

[Logux server]: https://github.com/logux/logux-server

<a href="https://evilmartians.com/?utm_source=logux-client">
  <img src="https://evilmartians.com/badges/sponsored-by-evil-martians.svg"
       alt="Sponsored by Evil Martians" width="236" height="54">
</a>


## Getting Started

### Add Logux to your Project

This project uses npm package manager. So you will need Webpack or Browserify
to build a JS bundle for browsers.

Install Logux Client:

```js
npm install --save logux-client
```


### Add Credentials to the Client

You should use a secret token for authentication at the Logux server.

We suggest adding a special `token` column to the users table of your
application and filling it with auto-generated random strings.

When the user requests `index.html` from your app, HTTP server would add
`<meta>` tags with a token and Logux server URL.

```html
<meta name="token" content="<%= user.token %>" />
<meta name="server" content="wss://example.com:1337" />
```

However, it is not the only possible way for communication.
You could also use cookies or tools like [Gon].

[Gon]: https://github.com/gazay/gon


### Create Logux Client

Create Logux Client instance in your client-side JS;
`onready` event handler seems to be a good place for this:

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

Add callbacks for new events coming to the client log
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


### Emit Events

When you need to send information to server, just add an event to log:

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

Notify user if connection was lost:

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

Notify user on page leaving, if some data is not synchronized yet:

```js
window.onbeforeunload = function (e) {
  if (logux.sync.state === 'wait') {
    e.returnValue = 'Edits were not saved'
    return e.returnValue
  }
}
```
