import { LoguxError, TestTime, TestPair, TestLog } from '@logux/core'
import { delay } from 'nanodelay'

import { CrossTabClient, status } from '../index.js'

function setState(node: any, state: string): void {
  node.setState(state)
}

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

async function createTest(options?: { duration?: number }): Promise<{
  client: CrossTabClient<{}, TestLog>
  calls: string[]
  args: any[]
}> {
  let pair = new TestPair()
  let client = new CrossTabClient<{}, TestLog>({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: '10',
    time: new TestTime()
  })

  client.role = 'leader'
  client.node.catch(() => {})

  let calls: string[] = []
  let args: any[] = []

  status(
    client,
    (state, details) => {
      calls.push(state)
      args.push(details)
    },
    options
  )

  return { client, calls, args }
}

it('notifies about states', async () => {
  let test = await createTest()
  setState(test.client.node, 'connecting')
  await delay(105)
  test.client.node.connected = true
  setState(test.client.node, 'synchronized')
  expect(test.calls).toEqual(['disconnected', 'connecting', 'synchronized'])
})

it('notifies about other tab states', async () => {
  let test = await createTest()
  test.client.state = 'synchronized'
  emit(test.client, 'state')
  expect(test.calls).toEqual(['disconnected', 'synchronized'])
})

it('notifies only about wait for sync actions', async () => {
  let test = await createTest({ duration: 10 })
  test.client.node.log.add(
    { type: 'logux/subscribe' },
    { sync: true, reasons: ['t'] }
  )
  test.client.node.log.add(
    { type: 'logux/unsubscribe' },
    { sync: true, reasons: ['t'] }
  )
  expect(test.calls).toEqual(['disconnected'])
  test.client.node.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  test.client.node.log.add({ type: 'B' }, { sync: true, reasons: ['t'] })
  setState(test.client.node, 'connecting')
  await delay(105)
  setState(test.client.node, 'disconnected')
  setState(test.client.node, 'connecting')
  await delay(105)
  setState(test.client.node, 'sending')
  setState(test.client.node, 'synchronized')
  expect(test.calls).toEqual([
    'disconnected',
    'wait',
    'connectingAfterWait',
    'wait',
    'connectingAfterWait',
    'sendingAfterWait'
  ])
  test.client.node.log.add({ type: 'logux/undo', id: '3 10:1:1 0' })
  await delay(1)
  expect(test.calls).toEqual([
    'disconnected',
    'wait',
    'connectingAfterWait',
    'wait',
    'connectingAfterWait',
    'sendingAfterWait'
  ])
  test.client.node.log.add({ type: 'logux/processed', id: '4 10:1:1 0' })
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
  setState(test.client.node, 'connecting')
  test.client.node.connected = true
  setState(test.client.node, 'synchronized')
  expect(test.calls).toEqual(['disconnected', 'synchronized'])
})

it('notifies about synchronization error', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()

  let error1 = { type: 'any error' }
  emit(test.client.node, 'error', error1)

  let error2 = new LoguxError('timeout', 10, true)
  emit(test.client.node, 'clientError', error2)

  expect(test.calls).toEqual(['disconnected', 'syncError', 'syncError'])
  expect(test.args).toEqual([undefined, { error: error1 }, { error: error2 }])
})

it('ignores timeout error', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()
  let error1 = { type: 'timeout' }
  emit(test.client.node, 'error', error1)
  expect(test.calls).toEqual(['disconnected'])
})

it('notifies about old client', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()
  let protocol = new LoguxError('wrong-protocol', {
    supported: '1.0.0',
    used: '0.1.0'
  })
  emit(test.client.node, 'error', protocol)

  let subprotocol = new LoguxError('wrong-subprotocol', {
    supported: '1.0.0',
    used: '0.1.0'
  })
  emit(test.client.node, 'error', subprotocol)

  setState(test.client.node, 'disconnected')

  expect(test.calls).toEqual(['disconnected', 'protocolError', 'protocolError'])
})

it('notifies about server error', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()
  test.client.node.log.add({ type: 'logux/undo', reason: 'error' })
  expect(test.calls).toEqual(['disconnected', 'error'])
  expect(test.args[1].action.type).toBe('logux/undo')
  expect(test.args[1].meta.time).toBe(1)
})

it('notifies about problem with access', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()
  test.client.node.log.add({ type: 'logux/undo', reason: 'denied' })
  expect(test.calls).toEqual(['disconnected', 'denied'])
  expect(test.args[1].action.type).toBe('logux/undo')
  expect(test.args[1].meta.time).toBe(1)
})

it('removes listeners', () => {
  let pair = new TestPair()
  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: '10',
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

  expect(calls).toBe(1)
})
