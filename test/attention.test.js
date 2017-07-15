var CrossTabClient = require('logux-client').CrossTabClient
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair
var SyncError = require('logux-sync').SyncError

var attention = require('../attention')

var nextHidden
Object.defineProperty(document, 'hidden', {
  get: function () {
    if (typeof nextHidden !== 'undefined') {
      var value = nextHidden
      nextHidden = undefined
      return value
    } else {
      return true
    }
  }
})

function createClient () {
  document.title = 'title'

  var client = new CrossTabClient({
    subprotocol: '1.0.0',
    userId: false,
    url: 'wss://localhost:1337'
  })

  var pair = new TestPair()
  var sync = new BaseSync('client', client.log, pair.left)
  sync.catch(function () { })
  sync.emitter = client.sync.emitter
  client.sync = sync
  client.role = 'leader'

  return pair.left.connect().then(function () {
    return client
  })
}

var originAdd = document.addEventListener
var originRemove = document.removeEventListener
afterEach(function () {
  document.addEventListener = originAdd
  document.removeEventListener = originRemove
})

it('receives errors', function () {
  return createClient().then(function (client) {
    attention(client)
    client.sync.emitter.emit('error', new Error('test'))
    expect(document.title).toBe('* title')
  })
})

it('receives undo', function () {
  return createClient().then(function (client) {
    attention(client)
    client.log.add({ type: 'logux/undo', reason: 'error' })
    expect(document.title).toBe('* title')
  })
})

it('returns unbind function', function () {
  document.removeEventListener = jest.fn()

  return createClient().then(function (client) {
    var unbind = attention(client)
    unbind()
    expect(document.removeEventListener).toBeCalled()
  })
})

it('allows to miss timeout error', function () {
  return createClient().then(function (client) {
    attention(client)
    client.sync.emitter.emit('error', new SyncError(client.sync, 'timeout'))
    expect(document.title).toBe('title')
  })
})

it('sets old title when user open a tab', function () {
  var listener
  document.addEventListener = function (name, callback) {
    expect(name).toEqual('visibilitychange')
    listener = callback
  }

  return createClient().then(function (client) {
    attention(client)

    client.sync.emitter.emit('error', new Error('test'))
    expect(document.title).toBe('* title')

    nextHidden = false
    listener()
    expect(document.title).toBe('title')
  })
})

it('does not double title changes', function () {
  return createClient().then(function (client) {
    attention(client)

    client.sync.emitter.emit('error', new Error('test'))
    client.sync.emitter.emit('error', new Error('test'))
    expect(document.title).toBe('* title')
  })
})

it('does not change title of visible tab', function () {
  return createClient().then(function (client) {
    attention(client)

    nextHidden = false
    client.sync.emitter.emit('error', new Error('test'))
    expect(document.title).toBe('title')
  })
})
