var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var badgeMessages = require('../badge/ru')
var badgeStyles = require('../badge/default')
var badge = require('../badge')

var OPTIONS = {
  styles: badgeStyles,
  messages: badgeMessages
}

function findBadgeNode () {
  return document.getElementById('logux-badge')
}

function getBadgeMessage () {
  return findBadgeNode().childNodes[0].innerHTML
}

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('test1', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () {})
  return pair.left.connect().then(function () {
    return pair
  })
}

afterEach(function () {
  var node = findBadgeNode()
  if (node) document.body.removeChild(node)
})

it('should inject base widget styles', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

    expect(findBadgeNode().style.position).toEqual('fixed')
    expect(findBadgeNode().childNodes[0].style.display).toEqual('table-cell')
  })
})

it('should handle synchronized state', function (done) {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

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
    expect(getBadgeMessage()).toEqual(badgeMessages.synchronized)
    setTimeout(function () {
      expect(findBadgeNode().style.display).toEqual('none')
      done()
    }, 3000)
  })
})

it('should handle disconnected state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

    test.leftSync.connected = true
    test.leftSync.setState('connected')
    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.disconnected)
  })
})

it('should handle wait state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('wait')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.wait)
  })
})

it('should handle sending state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('sending')
    expect(findBadgeNode().style.display).toEqual('none')

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    test.leftSync.setState('sending')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.sending)
  })
})

it('should handle connecting state', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('connecting')
    expect(findBadgeNode().style.display).toEqual('none')

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    test.leftSync.setState('connecting')
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.connecting)
  })
})

it('should handle error', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

    test.leftSync.emitter.emit('error', { type: 'any error' })
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.error)
  })
})

it('should handle server errors', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

    var errorOptions = {
      testError: 'testError',
      supported: [1, 2, 3],
      used: [1, 2, 3]
    }

    var error = new SyncError(test.leftSync, 'wrong-format')
    test.leftSync.emitter.emit('error', error)
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.error)

    error = new SyncError(test.leftSync, 'wrong-subprotocol', errorOptions)
    test.leftSync.emitter.emit('error', error)
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.protocolError)

    error = new SyncError(test.leftSync, 'wrong-protocol', errorOptions)
    test.leftSync.emitter.emit('error', error)
    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.protocolError)
  })
})

it('should handle client error', function () {
  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, OPTIONS)

    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('clientError', error)

    expect(findBadgeNode().style.display).toEqual('block')
    expect(findBadgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
    expect(getBadgeMessage()).toEqual(badgeMessages.error)
  })
})

it('should handle bottom and left side of position setting', function () {
  var opts = { }
  for (var i in OPTIONS) opts[i] = OPTIONS[i]
  opts.position = 'bottom-left'

  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, opts)

    expect(findBadgeNode().style.bottom).toEqual('0px')
    expect(findBadgeNode().style.left).toEqual('0px')
  })
})

it('should handle top and right side of position setting', function () {
  var opts = { }
  for (var i in OPTIONS) opts[i] = OPTIONS[i]
  opts.position = 'top-right'

  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, opts)

    expect(findBadgeNode().style.top).toEqual('0px')
    expect(findBadgeNode().style.right).toEqual('0px')
  })
})

it('should handle center/middle position setting', function () {
  var opts = { }
  for (var i in OPTIONS) opts[i] = OPTIONS[i]
  opts.position = 'center-middle'

  return createTest().then(function (test) {
    badge({ sync: test.leftSync }, opts)

    expect(findBadgeNode().style.top).toEqual('50%')
    expect(findBadgeNode().style.left).toEqual('50%')
    expect(findBadgeNode().style.transform).toEqual('translate(-50%, -50%)')
  })
})

it('should return unbind function and remove badge from DOM', function () {
  return createTest().then(function (test) {
    var unbind = badge({ sync: test.leftSync }, OPTIONS)
    unbind()

    test.leftSync.emitter.emit('error', { type: 'wrong-protocol' })
    expect(findBadgeNode()).toEqual(null)
  })
})
