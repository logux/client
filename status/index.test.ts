import { LoguxError, type TestLog, TestPair, TestTime } from '@logux/core'
import { delay } from 'nanodelay'
import { expect, it } from 'vitest'

import { CrossTabClient, status } from '../index.js'

function setState(node: any, state: string): void {
  node.setState(state)
}

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

function createTest(options?: { duration?: number }): Promise<{
  args: any[]
  calls: string[]
  client: CrossTabClient<object, TestLog>
}> {
  let pair = new TestPair()
  let client = new CrossTabClient<object, TestLog>({
    server: pair.left,
    subprotocol: '1.0.0',
    time: new TestTime(),
    userId: '10'
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

  return Promise.resolve({ args, calls, client })
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
    { reasons: ['t'], sync: true }
  )
  test.client.node.log.add(
    { type: 'logux/unsubscribe' },
    { reasons: ['t'], sync: true }
  )
  expect(test.calls).toEqual(['disconnected'])
  test.client.node.log.add({ type: 'A' }, { reasons: ['t'], sync: true })
  test.client.node.log.add({ type: 'B' }, { reasons: ['t'], sync: true })
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
  test.client.node.log.add({ id: '3 10:1:1 0', type: 'logux/undo' })
  await delay(1)
  expect(test.calls).toEqual([
    'disconnected',
    'wait',
    'connectingAfterWait',
    'wait',
    'connectingAfterWait',
    'sendingAfterWait'
  ])
  test.client.node.log.add({ id: '4 10:1:1 0', type: 'logux/processed' })
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
  test.client.node.log.add({ reason: 'error', type: 'logux/undo' })
  expect(test.calls).toEqual(['disconnected', 'error'])
  expect(test.args[1].action.type).toBe('logux/undo')
  expect(test.args[1].meta.time).toBe(1)
})

it('notifies about problem with access', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()
  test.client.node.log.add({ reason: 'denied', type: 'logux/undo' })
  expect(test.calls).toEqual(['disconnected', 'denied'])
  expect(test.args[1].action.type).toBe('logux/undo')
  expect(test.args[1].meta.time).toBe(1)
})

it('removes listeners', () => {
  let pair = new TestPair()
  let client = new CrossTabClient({
    server: pair.left,
    subprotocol: '1.0.0',
    time: new TestTime(),
    userId: '10'
  })

  let calls = 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let unbind = status(client, (state, details) => {
    if (state === 'denied') {
      calls += 1
    }
  })

  client.log.add({ reason: 'denied', type: 'logux/undo' })
  unbind()
  client.log.add({ reason: 'denied', type: 'logux/undo' })

  expect(calls).toBe(1)
})
