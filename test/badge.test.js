var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var messages = require('../badge/en')
var styles = require('../badge/default')
var badge = require('../badge')

function badgeNode () {
  return document.querySelector('div')
}

function getBadgeMessage () {
  return badgeNode().childNodes[0].innerHTML
}

function wait (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function createTest (override) {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('client', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () {})
  return pair.left.connect().then(function () {
    var opts = { messages: messages, styles: styles }
    for (var i in override) {
      opts[i] = override[i]
    }
    badge({ sync: pair.leftSync }, opts)
    return pair
  })
}

afterEach(function () {
  var node = badgeNode()
  if (node) document.body.removeChild(node)
})

it('injects base widget styles', function () {
  return createTest().then(function () {
    expect(badgeNode().style.position).toEqual('fixed')
    expect(badgeNode().childNodes[0].style.display).toEqual('table-cell')
  })
})

it('shows synchronized state', function () {
  var test
  return createTest({ duration: 10 }).then(function (created) {
    test = created

    test.leftSync.connected = true
    test.leftSync.setState('synchronized')
    expect(badgeNode().style.display).toEqual('none')

    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    return test.leftSync.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    test.leftSync.setState('connecting')
    test.leftSync.connected = true
    test.leftSync.setState('synchronized')
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.synchronized)
    return wait(10)
  }).then(function () {
    expect(badgeNode().style.display).toEqual('none')
  })
})

it('shows disconnected state', function () {
  return createTest().then(function (test) {
    test.leftSync.connected = true
    test.leftSync.setState('connected')
    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.disconnected)
  })
})

it('shows wait state', function () {
  return createTest().then(function (test) {
    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('wait')
    return test.leftSync.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.wait)
  })
})

it('shows sending state', function () {
  var test
  return createTest().then(function (created) {
    test = created

    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('connecting')
    expect(getBadgeMessage()).toEqual(messages.disconnected)

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    return test.leftSync.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    test.leftSync.setState('connecting')
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.wait)
    return wait(105).then(function () {
      expect(getBadgeMessage()).toEqual(messages.sending)

      test.leftSync.setState('sending')
      expect(getBadgeMessage()).toEqual(messages.sending)
    })
  })
})

it('shows error', function () {
  return createTest().then(function (test) {
    test.leftSync.emitter.emit('error', { type: 'any error' })
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.syncError)
  })
})

it('shows server errors', function () {
  return createTest().then(function (test) {
    var protocol = new SyncError(test.leftSync, 'wrong-protocol', { })
    test.leftSync.emitter.emit('error', protocol)
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.protocolError)

    var subprotocol = new SyncError(test.leftSync, 'wrong-subprotocol', { })
    test.leftSync.emitter.emit('error', subprotocol)
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.protocolError)
  })
})

it('shows client error', function () {
  return createTest().then(function (test) {
    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('clientError', error)

    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.syncError)
  })
})

it('shows error undo actions', function () {
  return createTest().then(function (test) {
    test.leftSync.log.add({ type: 'logux/undo', reason: 'error' })
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.error)
  })
})

it('shows denied undo actions', function () {
  return createTest().then(function (test) {
    test.leftSync.log.add({ type: 'logux/undo', reason: 'denied' })
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.denied)
  })
})

it('supports bottom and left side of position setting', function () {
  return createTest({ position: 'bottom-left' }).then(function () {
    expect(badgeNode().style.bottom).toEqual('0px')
    expect(badgeNode().style.left).toEqual('0px')
  })
})

it('supports middle and right side of position setting', function () {
  return createTest({ position: 'middle-right' }).then(function () {
    expect(badgeNode().style.top).toEqual('50%')
    expect(badgeNode().style.right).toEqual('0px')
    expect(badgeNode().style.transform).toEqual('translateY(-50%)')
  })
})

it('supports bottom and center side of position setting', function () {
  return createTest({ position: 'bottom-center' }).then(function () {
    expect(badgeNode().style.bottom).toEqual('0px')
    expect(badgeNode().style.left).toEqual('50%')
    expect(badgeNode().style.transform).toEqual('translateX(-50%)')
  })
})

it('supports middle-center position setting', function () {
  return createTest({ position: 'middle-center' }).then(function () {
    expect(badgeNode().style.top).toEqual('50%')
    expect(badgeNode().style.left).toEqual('50%')
    expect(badgeNode().style.transform).toEqual('translate(-50%, -50%)')
  })
})

it('supports center-middle position setting', function () {
  return createTest({ position: 'center-middle' }).then(function () {
    expect(badgeNode().style.top).toEqual('50%')
    expect(badgeNode().style.left).toEqual('50%')
    expect(badgeNode().style.transform).toEqual('translate(-50%, -50%)')
  })
})

it('removes badge from DOM', function () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('client', TestTime.getLog(), pair.left)
  var opts = { messages: messages, styles: styles }
  var unbind = badge({ sync: pair.leftSync }, opts)

  unbind()

  expect(badgeNode()).toEqual(null)
  pair.leftSync.emitter.emit('error', { type: 'wrong-protocol' })
})
