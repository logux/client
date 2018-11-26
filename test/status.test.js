var SyncError = require('@logux/core').SyncError
var TestTime = require('@logux/core').TestTime
var TestPair = require('@logux/core').TestPair
var delay = require('nanodelay')

var CrossTabClient = require('../cross-tab-client')
var status = require('../status')

function createTest (options) {
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

  return pair.left.connect().then(function () {
    pair.calls = []
    pair.args = []
    status(client, function (state, details) {
      pair.calls.push(state)
      pair.args.push(details)
    }, options)
    return pair
  })
}

it('notifies about states', function () {
  return createTest().then(function (test) {
    test.leftNode.connected = false
    test.leftNode.setState('disconnected')
    test.leftNode.setState('connecting')
    return delay(105, test)
  }).then(function (test) {
    test.leftNode.connected = true
    test.leftNode.setState('synchronized')
    expect(test.calls).toEqual([
      'disconnected', 'connecting', 'synchronized'
    ])
  })
})

it('notifies about other tab states', function () {
  return createTest().then(function (test) {
    test.client.state = 'disconnected'
    test.client.emitter.emit('state')
    expect(test.calls).toEqual(['disconnected'])
  })
})

it('notifies only about wait for sync actions', function () {
  return createTest({ duration: 10 }).then(function (test) {
    test.leftNode.connected = false
    test.leftNode.setState('disconnected')
    expect(test.calls).toEqual(['disconnected'])
    test.leftNode.log.add(
      { type: 'logux/subscribe' }, { sync: true, reasons: ['t'] }
    )
    test.leftNode.log.add(
      { type: 'logux/unsubscribe' }, { sync: true, reasons: ['t'] }
    )
    expect(test.calls).toEqual(['disconnected'])
    test.leftNode.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
    test.leftNode.log.add({ type: 'B' }, { sync: true, reasons: ['t'] })
    test.leftNode.setState('connecting')
    return delay(105, test)
  }).then(function (test) {
    test.leftNode.setState('disconnected')
    test.leftNode.setState('connecting')
    return delay(105, test)
  }).then(function (test) {
    test.leftNode.setState('sending')
    test.leftNode.setState('synchronized')
    expect(test.calls).toEqual([
      'disconnected',
      'wait',
      'connectingAfterWait',
      'wait',
      'connectingAfterWait',
      'sendingAfterWait'
    ])
    test.leftNode.log.add({ type: 'logux/undo', id: '3 10:1:1 0' })
    return delay(1, test)
  }).then(function (test) {
    expect(test.calls).toEqual([
      'disconnected',
      'wait',
      'connectingAfterWait',
      'wait',
      'connectingAfterWait',
      'sendingAfterWait'
    ])
    test.leftNode.log.add({ type: 'logux/processed', id: '4 10:1:1 0' })
    return delay(1, test)
  }).then(function (test) {
    expect(test.calls).toEqual([
      'disconnected',
      'wait',
      'connectingAfterWait',
      'wait',
      'connectingAfterWait',
      'sendingAfterWait',
      'synchronizedAfterWait'
    ])
    return delay(15, test)
  }).then(function (test) {
    expect(test.calls).toEqual([
      'disconnected',
      'wait',
      'connectingAfterWait',
      'wait',
      'connectingAfterWait',
      'sendingAfterWait',
      'synchronizedAfterWait',
      'synchronized'
    ])
  })
})

it('skips connecting notification if it took less than 100ms', function () {
  return createTest().then(function (test) {
    test.leftNode.connected = false
    test.leftNode.setState('disconnected')
    test.leftNode.setState('connecting')
    test.leftNode.connected = true
    test.leftNode.setState('synchronized')
    expect(test.calls).toEqual(['disconnected', 'synchronized'])
  })
})

it('notifies about synchronization error', function () {
  return createTest().then(function (test) {
    var error1 = { type: 'any error' }
    test.leftNode.emitter.emit('error', error1)

    var error2 = new SyncError('test', 'type', true)
    test.leftNode.emitter.emit('clientError', error2)

    expect(test.calls).toEqual(['syncError', 'syncError'])
    expect(test.args).toEqual([{ error: error1 }, { error: error2 }])
  })
})

it('ignores timeout error', function () {
  return createTest().then(function (test) {
    var error1 = { type: 'timeout' }
    test.leftNode.emitter.emit('error', error1)
    expect(test.calls).toEqual([])
  })
})

it('notifies about old client', function () {
  return createTest().then(function (test) {
    var protocol = new SyncError('wrong-protocol', { })
    test.leftNode.emitter.emit('error', protocol)

    var subprotocol = new SyncError('wrong-subprotocol', { })
    test.leftNode.emitter.emit('error', subprotocol)

    test.leftNode.setState('disconnected')

    expect(test.calls).toEqual(['protocolError', 'protocolError'])
  })
})

it('notifies about server error', function () {
  return createTest().then(function (test) {
    test.leftNode.log.add({ type: 'logux/undo', reason: 'error' })
    expect(test.calls).toEqual(['error'])
    expect(test.args[0].action.type).toEqual('logux/undo')
    expect(test.args[0].meta.time).toEqual(1)
  })
})

it('notifies about problem with access', function () {
  return createTest().then(function (test) {
    test.leftNode.log.add({ type: 'logux/undo', reason: 'denied' })
    expect(test.calls).toEqual(['denied'])
    expect(test.args[0].action.type).toEqual('logux/undo')
    expect(test.args[0].meta.time).toEqual(1)
  })
})

it('removes listeners', function () {
  var pair = new TestPair()
  var client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 10,
    time: new TestTime()
  })

  var calls = 0
  var unbind = status(client, function (state) {
    if (state === 'denied') {
      calls += 1
    }
  })

  client.log.add({ type: 'logux/undo', reason: 'denied' })
  unbind()
  client.log.add({ type: 'logux/undo', reason: 'denied' })

  expect(calls).toEqual(1)
})
