# Logux Client

<img align="right" width="95" height="95" title="Logux logo"
     src="https://cdn.rawgit.com/logux/logux/master/logo.svg">

Logux is a client-server communication protocol. It synchronizes action
between clients and server logs.

This 8 KB library allows you to put action (which look similar
to Redux actions) to a local log and synchronize them with [Logux Server]
and thus with every other client being online.

This is a low-level client API. Redux-like API, which is supposed
to be more suitable for most of developers, is coming soon.

See also [Logux Status] for UX best practices.

[Logux Server]: https://github.com/logux/logux-server
[Logux Status]: https://github.com/logux/logux-status

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
<meta name="user" content="<%= user.id %>" />
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
var CrossTabClient = require('logux-client/cross-tab-client')

var user = document.querySelector('meta[name=user]')
var token = document.querySelector('meta[name=token]')
var server = document.querySelector('meta[name=server]')

var logux = new CrossTabClient({
  credentials: token.content,
  subprotocol: '1.0.0',
  server: server.content,
  userId: user.content
})
logux.start()
```

If you sure, that your application will not be run in separated browser
tabs (for instance, you are developing a app for kiosk), you can use
`Client` instead of `CrossTabClient`.


### Process Actions

Add callbacks for new actions coming to the client log
(from server, other clients or local `logux.log.add` call):

```js
logux.on('add', function (action, meta) {
  if (action.type === 'CHANGE_TITLE') {
    var article = document.querySelector('.article[data-id=' + action.article + ']')
    if (article) {
      article.querySelector('.article__title').innerText = action.title
    }
  }
})
```

Read [Logux Core] docs for `logux.log` API.

[Logux Core]: https://github.com/logux/core


### Adding Actions

When you need to send information to server, just add an action to log:

```js
submit.addEventListener('click', function () {
  logux.log.add({
    type: 'CHANGE_TITLE',
    article: articleId.value,
    title: titleField.value
  }, {
    reasons: ['lastValue']
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


### Cross-Tab Communication

If user will open website in two different browser tabs, Logux anyway will have
single storage, so JS in tabs will have same actions.

You can set `tab` key in metadata to isolate action only in current tab:

```js
app.log.add(action, { tab: app.id })
```
