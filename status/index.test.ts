import {
  type AnyAction,
  LoguxError,
  type TestLog,
  TestPair,
  TestTime
} from '@logux/core'
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
    subprotocol: 10,
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
  expect(test.calls).toEqual(['disconnected', 'connecting'])
  await delay(505)
  expect(test.calls).toEqual(['disconnected', 'connecting', 'synchronized'])
})

it('notifies about other tab states', async () => {
  let test = await createTest()
  test.client.state = 'synchronized'
  emit(test.client, 'state')
  expect(test.calls).toEqual(['disconnected'])
  await delay(505)
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
  test.client.node.log.add({ id: '2 10:1:1', type: 'logux/undo' })
  await delay(1)
  expect(test.calls).toEqual([
    'disconnected',
    'wait',
    'connectingAfterWait',
    'wait',
    'connectingAfterWait',
    'sendingAfterWait'
  ])
  test.client.node.log.add({ id: '3 10:1:1', type: 'logux/processed' })
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
  expect(test.calls).toEqual(['disconnected'])
  await delay(505)
  expect(test.calls).toEqual(['disconnected', 'synchronized'])
})

it('notifies about synchronization error', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()

  let error1 = { type: 'any error' }
  emit(test.client.node, 'error', error1)

  let error2 = new LoguxError('timeout', 10, true)
  emit(test.client.node, 'clientError', error2)

  setState(test.client.node, 'disconnected')

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

it('notifies about wrong credentials', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()
  emit(test.client.node, 'error', { type: 'wrong-credentials' })
  setState(test.client.node, 'disconnected')
  expect(test.calls).toEqual(['disconnected', 'wrongCredentials'])
})

it('notifies about old client', async () => {
  let test = await createTest()
  await test.client.node.connection.connect()
  let protocol = new LoguxError('wrong-protocol', {
    supported: 5,
    used: 4
  })
  emit(test.client.node, 'error', protocol)

  let subprotocol = new LoguxError('wrong-subprotocol', {
    supported: 10,
    used: 9
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
    subprotocol: 10,
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

let lastId = 0

function receive(client: CrossTabClient, action: AnyAction): Promise<unknown> {
  lastId += 1
  return client.log.add(action, {
    id: `${lastId} server:uuid`,
    time: lastId
  })
}

it('notifies about the download progress', async () => {
  let test = await createTest()
  setState(test.client.node, 'connecting')
  await delay(105)
  expect(test.calls).toEqual(['disconnected', 'connecting'])

  await receive(test.client, { actions: 2, type: 'logux/prepare' })
  await receive(test.client, { type: 'A' })
  expect(test.calls).toEqual([
    'disconnected',
    'connecting',
    'receiving',
    'receiving'
  ])
  expect(test.args.slice(2)).toEqual([
    { done: 0, total: 2 },
    { done: 1, total: 2 }
  ])

  // The progress is more useful than the state
  setState(test.client.node, 'sending')
  expect(test.calls).toHaveLength(4)

  test.client.node.connected = true
  await receive(test.client, { type: 'B' })
  setState(test.client.node, 'synchronized')
  await delay(505)
  expect(test.calls).toEqual([
    'disconnected',
    'connecting',
    'receiving',
    'receiving',
    'receiving',
    'sending',
    'synchronized'
  ])
  expect(test.args[4]).toEqual({ done: 2, total: 2 })
})

it('switches to the download in the middle of the session', async () => {
  let test = await createTest()
  test.client.node.connected = true
  setState(test.client.node, 'synchronized')
  await delay(505)
  expect(test.calls).toEqual(['disconnected', 'synchronized'])

  await receive(test.client, { actions: 1, type: 'logux/prepare' })
  await receive(test.client, { type: 'A' })
  await delay(505)
  expect(test.calls).toEqual([
    'disconnected',
    'synchronized',
    'receiving',
    'receiving',
    'synchronized'
  ])
})

it('does not report old state during the download', async () => {
  let test = await createTest()
  test.client.node.connected = true
  setState(test.client.node, 'synchronized')
  await receive(test.client, { actions: 2, type: 'logux/prepare' })
  await delay(505)
  expect(test.calls).toEqual(['disconnected', 'receiving'])
})

it('counts only the actions from the server', async () => {
  let test = await createTest()
  setState(test.client.node, 'connecting')
  await delay(105)

  await receive(test.client, { actions: 2, type: 'logux/prepare' })
  await receive(test.client, { id: '1 10:1:1', type: 'logux/processed' })
  await receive(test.client, { id: '2 10:1:1', type: 'logux/undo' })
  await test.client.log.add({ type: 'A' }, { reasons: ['test'] })
  // Action from another tab of this client
  await test.client.log.add({ type: 'B' }, { id: '9 10:1:2', time: 9 })
  expect(test.calls).toEqual(['disconnected', 'connecting', 'receiving'])
  expect(test.args[2]).toEqual({ done: 0, total: 2 })

  await receive(test.client, { type: 'C' })
  expect(test.args[3]).toEqual({ done: 1, total: 2 })
})

it('stops the download progress on disconnect', async () => {
  let test = await createTest()
  setState(test.client.node, 'connecting')
  await receive(test.client, { actions: 2, type: 'logux/prepare' })
  expect(test.calls).toEqual(['disconnected', 'receiving'])

  setState(test.client.node, 'disconnected')
  expect(test.calls).toEqual(['disconnected', 'receiving', 'disconnected'])

  await receive(test.client, { type: 'A' })
  await delay(105)
  expect(test.calls).toHaveLength(3)
})
