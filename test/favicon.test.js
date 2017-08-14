var CrossTabClient = require('logux-client').CrossTabClient
var SyncError = require('logux-sync').SyncError
var TestPair = require('logux-sync').TestPair

var favicon = require('../favicon')

function getFavNode () {
  return document.querySelector('link[rel~="icon"]')
}

function getFavHref () {
  return getFavNode().href
}

function setFavHref (href) {
  getFavNode().href = href
}

function createClient () {
  var pair = new TestPair()
  var client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: false
  })

  client.sync.catch(function () { })
  client.role = 'leader'

  return pair.left.connect().then(function () {
    return client
  })
}

beforeAll(function () {
  var fav = document.createElement('link')
  fav.rel = 'icon'
  fav.href = ''
  document.head.appendChild(fav)
})

afterEach(function () {
  setFavHref('')
})

it('set favicon with current state', function () {
  return createClient().then(function (client) {
    favicon(client, {
      offline: '/offline.ico',
      normal: '/default.ico'
    })
    expect(getFavHref()).toBe('/offline.ico')
  })
})

it('changes favicon on state event', function () {
  getFavNode().href = '/custom.ico'
  return createClient().then(function (client) {
    favicon(client, {
      offline: '/offline.ico',
      normal: '/default.ico'
    })

    client.sync.setState('sending')
    expect(getFavHref()).toBe('/default.ico')

    client.sync.setState('disconnected')
    expect(getFavHref()).toBe('/offline.ico')
  })
})

it('works without favicon tag', function () {
  getFavNode().remove()
  return createClient().then(function (client) {
    favicon(client, { offline: '/offline.ico' })
    expect(getFavHref()).toBe('/offline.ico')

    client.sync.setState('sending')
    expect(getFavHref()).toBe('')
  })
})

it('uses current favicon as normal', function () {
  getFavNode().href = '/custom.ico'
  return createClient().then(function (client) {
    favicon(client, { offline: '/offline.ico' })
    client.sync.setState('sending')
    expect(getFavHref()).toBe('/custom.ico')
  })
})

it('does not double favicon changes', function () {
  return createClient().then(function (client) {
    favicon(client, { error: '/error.ico' })
    client.sync.emitter.emit('error', new Error('test'))
    expect(getFavHref()).toBe('/error.ico')

    setFavHref('')
    client.sync.emitter.emit('error', new Error('test'))
    expect(getFavHref()).toBe('')
  })
})

it('uses error icon on undo', function () {
  return createClient().then(function (client) {
    favicon(client, { error: '/error.ico' })
    client.log.add({ type: 'logux/undo', reason: 'error' })
    expect(getFavHref()).toBe('/error.ico')
  })
})

it('allows to miss timeout error', function () {
  return createClient().then(function (client) {
    favicon(client, { error: '/error.ico' })
    client.sync.emitter.emit('error', new SyncError(client.sync, 'timeout'))
    expect(getFavHref()).toBe('')
  })
})

it('does not override error by offline', function () {
  return createClient().then(function (client) {
    favicon(client, {
      offline: '/offline.ico',
      error: '/error.ico'
    })
    client.sync.emitter.emit('error', new Error('test'))
    expect(getFavHref()).toBe('/error.ico')

    client.sync.setState('disconnected')
    expect(getFavHref()).toBe('/error.ico')
  })
})

it('supports cross-tab synchronization', function () {
  return createClient().then(function (client) {
    favicon(client, {
      offline: '/offline.ico',
      normal: '/default.ico'
    })

    client.state = 'sending'
    client.emitter.emit('state')
    expect(getFavHref()).toBe('/default.ico')
  })
})

it('returns unbind function', function () {
  return createClient().then(function (client) {
    var unbind = favicon(client, { error: '/error.ico' })

    unbind()
    client.sync.emitter.emit('error', new Error('test'))

    expect(getFavHref()).not.toBe('/error.ico')
  })
})
