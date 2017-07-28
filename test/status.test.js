var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var status = require('../status')

var CALLBACKS = [
  'synchronized', 'disconnected', 'wait', 'connecting', 'sending',
  'syncError', 'protocolError', 'error', 'denied'
]

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('client', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () {})
  return pair.left.connect().then(function () {
    var callbacks = { }
    pair.calls = []
    pair.args = []
    CALLBACKS.forEach(function (i) {
      callbacks[i] = function () {
        pair.calls.push(i)
        pair.args.push(Array.prototype.slice.call(arguments, 0))
      }
    })

    status({ sync: pair.leftSync }, callbacks)
    return pair
  })
}

it('notifies about states', function () {
  return createTest({ duration: 10 }).then(function (test) {
    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('wait')
    test.leftSync.setState('connecting')
    test.leftSync.connected = true
    test.leftSync.setState('synchronized')
    expect(test.calls).toEqual([
      'disconnected', 'wait', 'connecting', 'synchronized'
    ])
  })
})

it('notifies about synchronization error', function () {
  return createTest().then(function (test) {
    var error1 = { type: 'any error' }
    test.leftSync.emitter.emit('error', error1)

    var error2 = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('clientError', error2)

    expect(test.calls).toEqual(['syncError', 'syncError'])
    expect(test.args).toEqual([[error1], [error2]])
  })
})

it('notifies about old client', function () {
  return createTest().then(function (test) {
    var protocol = new SyncError(test.leftSync, 'wrong-protocol', { })
    test.leftSync.emitter.emit('error', protocol)

    var subprotocol = new SyncError(test.leftSync, 'wrong-subprotocol', { })
    test.leftSync.emitter.emit('error', subprotocol)

    expect(test.calls).toEqual(['protocolError', 'protocolError'])
  })
})

it('notifies about server error', function () {
  return createTest().then(function (test) {
    test.leftSync.log.add({ type: 'logux/undo', reason: 'error' })
    expect(test.calls).toEqual(['sending', 'error'])
    expect(test.args[1][0].type).toEqual('logux/undo')
    expect(test.args[1][1].time).toEqual(1)
  })
})

it('notifies about problem with access', function () {
  return createTest().then(function (test) {
    test.leftSync.log.add({ type: 'logux/undo', reason: 'denied' })
    expect(test.calls).toEqual(['sending', 'denied'])
    expect(test.args[1][0].type).toEqual('logux/undo')
    expect(test.args[1][1].time).toEqual(1)
  })
})

it('calls only passed callbacks', function () {
  var pair = new TestPair()
  var sync = new BaseSync('client', TestTime.getLog(), pair.left)

  var calls = 0
  status({ sync: sync }, {
    denied: function () {
      calls += 1
    }
  })

  sync.log.add({ type: 'logux/undo', reason: 'error' })
  sync.log.add({ type: 'logux/undo', reason: 'denied' })

  expect(calls).toEqual(1)
})

it('removes listeners', function () {
  var pair = new TestPair()
  var sync = new BaseSync('client', TestTime.getLog(), pair.left)

  var calls = 0
  var unbind = status({ sync: sync }, {
    denied: function () {
      calls += 1
    }
  })

  sync.log.add({ type: 'logux/undo', reason: 'denied' })
  unbind()
  sync.log.add({ type: 'logux/undo', reason: 'denied' })

  expect(calls).toEqual(1)
})
