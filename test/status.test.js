let { LoguxError, TestTime, TestPair } = require('@logux/core')
let { delay } = require('nanodelay')

let CrossTabClient = require('../cross-tab-client')
let status = require('../status')

async function createTest (options) {
  let pair = new TestPair()
  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 10,
    time: new TestTime()
  })

  client.role = 'leader'
  client.node.catch(() => { })

  pair.client = client
  pair.leftNode = client.node

  await pair.left.connect()
  pair.calls = []
  pair.args = []
  status(client, (state, details) => {
    pair.calls.push(state)
    pair.args.push(details)
  }, options)
  return pair
}

it('notifies about states', async () => {
  let test = await createTest()
  test.leftNode.connected = false
  test.leftNode.setState('disconnected')
  test.leftNode.setState('connecting')
  await delay(105)
  test.leftNode.connected = true
  test.leftNode.setState('synchronized')
  expect(test.calls).toEqual(['disconnected', 'connecting', 'synchronized'])
})

it('notifies about other tab states', async () => {
  let test = await createTest()
  test.client.state = 'disconnected'
  test.client.emitter.emit('state')
  expect(test.calls).toEqual(['disconnected'])
})

it('notifies only about wait for sync actions', async () => {
  let test = await createTest({ duration: 10 })
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
  await delay(105)
  test.leftNode.setState('disconnected')
  test.leftNode.setState('connecting')
  await delay(105)
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
  await delay(1)
  expect(test.calls).toEqual([
    'disconnected',
    'wait',
    'connectingAfterWait',
    'wait',
    'connectingAfterWait',
    'sendingAfterWait'
  ])
  test.leftNode.log.add({ type: 'logux/processed', id: '4 10:1:1 0' })
  await delay(1)
  expect(test.calls).toEqual([
    'disconnected',
    'wait',
    'connectingAfterWait',
    'wait',
    'connectingAfterWait',
    'sendingAfterWait',
    'synchronizedAfterWait'
  ])
  await delay(15)
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

it('skips connecting notification if it took less than 100ms', async () => {
  let test = await createTest()
  test.leftNode.connected = false
  test.leftNode.setState('disconnected')
  test.leftNode.setState('connecting')
  test.leftNode.connected = true
  test.leftNode.setState('synchronized')
  expect(test.calls).toEqual(['disconnected', 'synchronized'])
})

it('notifies about synchronization error', async () => {
  let test = await createTest()
  let error1 = { type: 'any error' }
  test.leftNode.emitter.emit('error', error1)

  let error2 = new LoguxError('test', 'type', true)
  test.leftNode.emitter.emit('clientError', error2)

  expect(test.calls).toEqual(['syncError', 'syncError'])
  expect(test.args).toEqual([{ error: error1 }, { error: error2 }])
})

it('ignores timeout error', async () => {
  let test = await createTest()
  let error1 = { type: 'timeout' }
  test.leftNode.emitter.emit('error', error1)
  expect(test.calls).toEqual([])
})

it('notifies about old client', async () => {
  let test = await createTest()
  let protocol = new LoguxError('wrong-protocol', { })
  test.leftNode.emitter.emit('error', protocol)

  let subprotocol = new LoguxError('wrong-subprotocol', { })
  test.leftNode.emitter.emit('error', subprotocol)

  test.leftNode.setState('disconnected')

  expect(test.calls).toEqual(['protocolError', 'protocolError'])
})

it('notifies about server error', async () => {
  let test = await createTest()
  test.leftNode.log.add({ type: 'logux/undo', reason: 'error' })
  expect(test.calls).toEqual(['error'])
  expect(test.args[0].action.type).toEqual('logux/undo')
  expect(test.args[0].meta.time).toEqual(1)
})

it('notifies about problem with access', async () => {
  let test = await createTest()
  test.leftNode.log.add({ type: 'logux/undo', reason: 'denied' })
  expect(test.calls).toEqual(['denied'])
  expect(test.args[0].action.type).toEqual('logux/undo')
  expect(test.args[0].meta.time).toEqual(1)
})

it('removes listeners', () => {
  let pair = new TestPair()
  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 10,
    time: new TestTime()
  })

  let calls = 0
  let unbind = status(client, state => {
    if (state === 'denied') {
      calls += 1
    }
  })

  client.log.add({ type: 'logux/undo', reason: 'denied' })
  unbind()
  client.log.add({ type: 'logux/undo', reason: 'denied' })

  expect(calls).toEqual(1)
})
