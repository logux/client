var CrossTabClient = require('logux-client').CrossTabClient
var SyncError = require('logux-core').SyncError
var TestTime = require('logux-core').TestTime
var TestPair = require('logux-core').TestPair
var delay = require('nanodelay')

var messages = require('../badge/en')
var styles = require('../badge/default')
var badge = require('../badge')

function badgeNode () {
  return document.querySelector('div')
}

function getBadgeMessage () {
  return badgeNode().childNodes[0].innerHTML
}

function createTest (override) {
  var pair = new TestPair()
  var client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 10,
    time: new TestTime()
  })

  client.role = 'leader'
  client.node.catch(function () { })

  pair.client = client
  pair.leftNode = client.node

  pair.leftNode.catch(function () {})
  return pair.left.connect().then(function () {
    var opts = { messages: messages, styles: styles }
    for (var i in override) {
      opts[i] = override[i]
    }
    badge(client, opts)
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

    test.leftNode.connected = true
    test.leftNode.setState('synchronized')
    expect(badgeNode().style.display).toEqual('none')

    test.leftNode.connected = false
    test.leftNode.setState('disconnected')
    return test.leftNode.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    test.leftNode.setState('connecting')
    test.leftNode.connected = true
    test.leftNode.setState('synchronized')
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.synchronized)
    return delay(10)
  }).then(function () {
    expect(badgeNode().style.display).toEqual('none')
  })
})

it('shows disconnected state', function () {
  return createTest().then(function (test) {
    test.leftNode.connected = true
    test.leftNode.setState('connected')
    test.leftNode.connected = false
    test.leftNode.setState('disconnected')
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.disconnected)
  })
})

it('shows wait state', function () {
  return createTest().then(function (test) {
    test.leftNode.connected = false
    test.leftNode.setState('disconnected')
    test.leftNode.setState('wait')
    return test.leftNode.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
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

    test.leftNode.connected = false
    test.leftNode.setState('disconnected')
    test.leftNode.setState('connecting')
    expect(getBadgeMessage()).toEqual(messages.disconnected)

    test.leftNode.connected = false
    test.leftNode.setState('wait')
    return test.leftNode.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    test.leftNode.setState('connecting')
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.wait)
    return delay(105).then(function () {
      expect(getBadgeMessage()).toEqual(messages.sending)

      test.leftNode.setState('sending')
      expect(getBadgeMessage()).toEqual(messages.sending)
    })
  })
})

it('shows error', function () {
  return createTest().then(function (test) {
    test.leftNode.emitter.emit('error', { type: 'any error' })
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.syncError)
  })
})

it('shows server errors', function () {
  return createTest().then(function (test) {
    var protocol = new SyncError(test.leftNode, 'wrong-protocol', { })
    test.leftNode.emitter.emit('error', protocol)
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.protocolError)

    var subprotocol = new SyncError(test.leftNode, 'wrong-subprotocol', { })
    test.leftNode.emitter.emit('error', subprotocol)
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.protocolError)
  })
})

it('shows client error', function () {
  return createTest().then(function (test) {
    var error = new SyncError(test.leftNode, 'test', 'type', true)
    test.leftNode.emitter.emit('clientError', error)

    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.syncError)
  })
})

it('shows error undo actions', function () {
  return createTest().then(function (test) {
    test.leftNode.log.add({ type: 'logux/undo', reason: 'error' })
    expect(badgeNode().style.display).toEqual('block')
    expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(messages.error)
  })
})

it('shows denied undo actions', function () {
  return createTest().then(function (test) {
    test.leftNode.log.add({ type: 'logux/undo', reason: 'denied' })
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
  var client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 10,
    time: new TestTime()
  })

  var opts = { messages: messages, styles: styles }
  var unbind = badge(client, opts)

  unbind()

  expect(badgeNode()).toBeNull()
  client.node.emitter.emit('error', { type: 'wrong-protocol' })
})
