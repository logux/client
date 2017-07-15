var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var messages = require('../badge/en')
var styles = require('../badge/default')
var badge = require('../badge')

var OPTS = { messages: messages, styles: styles }

function findBadgeNode () {
  return document.querySelector('div')
}

function getBadgeMessage () {
  return findBadgeNode().childNodes[0].innerHTML
}

function wait (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function merge (a, b) {
  var result = { }
  for (var i in a) result[i] = a[i]
  for (var j in b) result[j] = b[j]
  return result
}

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('client', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () {})
  return pair.left.connect().then(function () {
    return pair
  })
}

afterEach(function () {
  var node = findBadgeNode()
  if (node) document.body.removeChild(node)
})

it('injects base widget styles', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    expect(findBadgeNode().style.position).toEqual('fixed')
    expect(findBadgeNode().childNodes[0].style.display).toEqual('table-cell')
  })
})

it('handles synchronized state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, merge(OPTS, { duration: 10 }))

    test.leftSync.connected = true
    test.leftSync.setState('synchronized')
    expect(findBadgeNode().style.display).toEqual('none')

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    test.leftSync.setState('connecting')
    test.leftSync.connected = true
    test.leftSync.setState('synchronized')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.synchronized)
    return wait(10)
  }).then(function () {
    expect(findBadgeNode().style.display).toEqual('none')
  })
})

it('handles disconnected state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    test.leftSync.connected = true
    test.leftSync.setState('connected')
    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.disconnected)
  })
})

it('handles wait state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('wait')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.wait)
  })
})

it('handles sending state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('sending')
    expect(findBadgeNode().style.display).toEqual('none')

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    test.leftSync.setState('sending')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.sending)
  })
})

it('handles connecting state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('connecting')
    expect(findBadgeNode().style.display).toEqual('none')

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    test.leftSync.setState('connecting')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.connecting)
  })
})

it('handles error', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    test.leftSync.emitter.emit('error', { type: 'any error' })
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.syncError)
  })
})

it('handles server errors', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    var errorOPTS = {
      testError: 'testError',
      supported: [1, 2, 3],
      used: [1, 2, 3]
    }

    var error = new SyncError(test.leftSync, 'wrong-format')
    test.leftSync.emitter.emit('error', error)
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.syncError)

    error = new SyncError(test.leftSync, 'wrong-subprotocol', errorOPTS)
    test.leftSync.emitter.emit('error', error)
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.protocolError)

    error = new SyncError(test.leftSync, 'wrong-protocol', errorOPTS)
    test.leftSync.emitter.emit('error', error)
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.protocolError)
  })
})

it('handles client error', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('clientError', error)

    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.syncError)
  })
})

it('handles error undo actions', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    test.leftSync.log.add({ type: 'logux/undo', reason: 'error' })

    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.error)
  })
})

it('handles denied undo actions', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTS)

    test.leftSync.log.add({ type: 'logux/undo', reason: 'denied' })

    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.denied)
  })
})

it('handles bottom and left side of position setting', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, merge(OPTS, { position: 'bottom-left' }))

    expect(findBadgeNode().style.bottom).toEqual('0px')
    expect(findBadgeNode().style.left).toEqual('0px')
  })
})

it('handles top and right side of position setting', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, merge(OPTS, { position: 'top-right' }))

    expect(findBadgeNode().style.top).toEqual('0px')
    expect(findBadgeNode().style.right).toEqual('0px')
  })
})

it('handles center/middle position setting', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, merge(OPTS, { position: 'center-middle' }))

    expect(findBadgeNode().style.top).toEqual('50%')
    expect(findBadgeNode().style.left).toEqual('50%')
    expect(findBadgeNode().style.transform).toEqual('translate(-50%, -50%)')
  })
})

it('returns unbind function and remove badge from DOM', function () {
  return createTest().then(function (test) {
    var unbind = badge({ sync: test.leftSync }, OPTS)
    unbind()

    test.leftSync.emitter.emit('error', { type: 'wrong-protocol' })
    expect(findBadgeNode()).toEqual(null)
  })
})
