var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var status = require('../status')

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('client', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () {})
  return pair.left.connect().then(function () {
    pair.calls = []
    pair.args = []
    status({ sync: pair.leftSync }, function (state, details) {
      pair.calls.push(state)
      pair.args.push(details)
    })
    return pair
  })
}

it('notifies about states', function () {
  return createTest({ duration: 10 }).then(function (test) {
    test.leftSync.connected = false
    test.leftSync.setState('disconnected')
    test.leftSync.setState('connecting')
    test.leftSync.connected = true
    test.leftSync.setState('synchronized')
    expect(test.calls).toEqual([
      'disconnected', 'connecting', 'synchronized'
    ])
  })
})

it('notifies only about wait for sync actions', function () {
  var test
  return createTest({ duration: 10 }).then(function (created) {
    test = created

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    expect(test.calls).toEqual([])

    return test.leftSync.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    test.leftSync.setState('connecting')
    test.leftSync.setState('wait')
      test.leftSync.setState('connecting')
    test.leftSync.setState('sending')
    expect(test.calls).toEqual([
      'waitSync',
      'connectingAfterWait',
      'waitSync',
      'connectingAfterWait',
      'sendingAfterWait'
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
    expect(test.args).toEqual([{ error: error1 }, { error: error2 }])
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
    expect(test.args[1].action.type).toEqual('logux/undo')
    expect(test.args[1].meta.time).toEqual(1)
  })
})

it('notifies about problem with access', function () {
  return createTest().then(function (test) {
    test.leftSync.log.add({ type: 'logux/undo', reason: 'denied' })
    expect(test.calls).toEqual(['sending', 'denied'])
    expect(test.args[1].action.type).toEqual('logux/undo')
    expect(test.args[1].meta.time).toEqual(1)
  })
})

it('removes listeners', function () {
  var pair = new TestPair()
  var sync = new BaseSync('client', TestTime.getLog(), pair.left)

  var calls = 0
  var unbind = status({ sync: sync }, function (state) {
    if (state === 'denied') {
      calls += 1
    }
  })

  sync.log.add({ type: 'logux/undo', reason: 'denied' })
  unbind()
  sync.log.add({ type: 'logux/undo', reason: 'denied' })

  expect(calls).toEqual(1)
})
