import { delay } from 'nanodelay'
import { expect, it } from 'vitest'

import { TestClient } from '../index.js'

interface NameAction {
  type: 'name'
  userId: string
}

async function catchError(cb: () => Promise<any>): Promise<any> {
  let error: Error | undefined
  try {
    await cb()
  } catch (e) {
    if (e instanceof Error) error = e
  }
  if (!error) throw new Error('Error was no raised')
  return error
}

it('sets node ID', () => {
  let client = new TestClient('10')
  expect(client.nodeId).toBe('10:2:2')
})

it('collects actions', async () => {
  let client1 = new TestClient('10')
  let client2 = new TestClient('20', { server: client1.server })
  await Promise.all([client1.connect(), client2.connect()])

  await client1.sync({ type: 'A' })
  let action1 = await client1.sent(async () => {
    await client1.log.add({ type: 'local' })
    await client1.sync({ type: 'B' })
    await client2.sync({ type: 'C' })
  })
  expect(action1).toEqual([{ type: 'B' }])
})

it('connects, sends, and processes actions', async () => {
  let client = new TestClient('10')
  client.log.keepActions()
  client.server.log.keepActions()

  await client.log.add({ type: 'local' })
  await client.log.add({ type: 'offline1' }, { sync: true })
  expect(client.log.actions()).toEqual([
    { type: 'local' },
    { type: 'offline1' }
  ])
  expect(client.server.log.actions()).toEqual([])

  await client.connect()
  expect(client.server.log.actions()).toEqual([
    { type: 'offline1' },
    { id: '2 10:2:2 0', type: 'logux/processed' }
  ])

  await delay(10)
  expect(client.log.actions()).toEqual([
    { type: 'local' },
    { type: 'offline1' },
    { id: '2 10:2:2 0', type: 'logux/processed' }
  ])
  expect(client.log.entries()[2][1].nodes).toBeUndefined()

  client.disconnect()

  await client.server.sendAll({ type: 'offline2' })
  expect(client.server.log.actions()).toEqual([
    { type: 'offline1' },
    { id: '2 10:2:2 0', type: 'logux/processed' },
    { type: 'offline2' }
  ])

  await delay(10)
  expect(client.log.actions()).toHaveLength(3)

  await client.connect()
  await delay(10)
  expect(client.log.actions()).toEqual([
    { type: 'local' },
    { type: 'offline1' },
    { id: '2 10:2:2 0', type: 'logux/processed' },
    { type: 'offline2' }
  ])
})

it('supports channels', async () => {
  let client = new TestClient('10')
  client.log.keepActions()

  client.server.onChannel('users/1', { name: 'A', type: 'name', userId: '1' })

  client.server.onChannel('users/2', [
    { name: 'B1', type: 'name', userId: '2' },
    { name: 'B2', type: 'name', userId: '2' }
  ])

  client.server.onChannel('users/3', [
    [{ name: 'C', type: 'name', userId: '3' }, { time: 1 }]
  ])

  await client.connect()
  await client.sync(
    { channel: 'users/1', type: 'logux/subscribe' },
    { sync: true }
  )
  await client.sync(
    { channel: 'users/2', type: 'logux/subscribe' },
    { sync: true }
  )
  await client.sync(
    { channel: 'users/3', type: 'logux/subscribe' },
    { sync: true }
  )

  expect(client.subscribed('users/1')).toBe(true)
  expect(client.log.actions()).toEqual([
    { channel: 'users/1', type: 'logux/subscribe' },
    { name: 'C', type: 'name', userId: '3' },
    { name: 'A', type: 'name', userId: '1' },
    { id: '1 10:2:2 0', type: 'logux/processed' },
    { channel: 'users/2', type: 'logux/subscribe' },
    { name: 'B1', type: 'name', userId: '2' },
    { name: 'B2', type: 'name', userId: '2' },
    { id: '4 10:2:2 0', type: 'logux/processed' },
    { channel: 'users/3', type: 'logux/subscribe' },
    { id: '8 10:2:2 0', type: 'logux/processed' }
  ])

  await client.sync(
    { channel: 'users/1', type: 'logux/unsubscribe' },
    { sync: true }
  )
  expect(client.subscribed('users/1')).toBe(false)
  expect(client.subscribed('users/2')).toBe(true)

  client.disconnect()
  await delay(1)
  expect(client.subscribed('users/2')).toBe(false)
})

it('supports undo', async () => {
  let client = new TestClient('10')
  await client.connect()

  client.server.undoNext()
  let error1 = await catchError(() => client.sync({ type: 'test' }))
  expect(error1.message).toBe('Server undid test because of error')

  await client.sync({ type: 'test' })

  client.server.undoNext('test')
  client.server.undoNext('test', { key: 1 })

  let error2 = await catchError(() => client.sync({ type: 'test' }))
  expect(error2.message).toBe('Server undid test because of test')

  let error3 = await catchError(() => client.sync({ type: 'test' }))
  expect(error3.message).toBe('Server undid test because of test')
  expect(error3.action.key).toBe(1)
})

it('supports undo for specific action', async () => {
  let client = new TestClient('10')
  await client.connect()

  client.server.undoAction({ extra: 1, type: 'B' })
  await client.sync({ type: 'A' })
  let error = await catchError(() => client.sync({ extra: 1, type: 'B' }))
  expect(error.name).toBe('LoguxUndoError')
})

it('supports multiple clients with same server', async () => {
  let client1 = new TestClient('10')
  let client2 = new TestClient('20', { server: client1.server })
  client1.log.keepActions()
  client2.log.keepActions()

  await Promise.all([client1.connect(), client2.connect()])

  client1.server.onChannel('users/1', { name: 'A', type: 'name', userId: '1' })
  client1.server.resend<NameAction>('name', action => `users/${action.userId}`)

  await client1.sync({ type: 'default' })
  await delay(1)
  expect(client2.log.actions()).toEqual([{ type: 'default' }])

  await client2.sync({ channel: 'users/1', type: 'logux/subscribe' })
  expect(client1.log.actions()).toEqual([
    { type: 'default' },
    { id: '1 10:2:2 0', type: 'logux/processed' }
  ])
  expect(client2.log.actions()).toEqual([
    { type: 'default' },
    { channel: 'users/1', type: 'logux/subscribe' },
    { name: 'A', type: 'name', userId: '1' },
    { id: '3 20:3:3 0', type: 'logux/processed' }
  ])

  await client1.sync({ name: 'B', type: 'name', userId: '1' })
  await delay(10)
  expect(client1.log.actions()).toEqual([
    { type: 'default' },
    { id: '1 10:2:2 0', type: 'logux/processed' },
    { name: 'B', type: 'name', userId: '1' },
    { id: '6 10:2:2 0', type: 'logux/processed' }
  ])
  expect(client2.log.actions()).toEqual([
    { type: 'default' },
    { channel: 'users/1', type: 'logux/subscribe' },
    { name: 'A', type: 'name', userId: '1' },
    { id: '3 20:3:3 0', type: 'logux/processed' },
    { name: 'B', type: 'name', userId: '1' }
  ])
  expect(client2.log.entries()[3][1].channels).toBeUndefined()

  await client2.sync({ channel: 'users/1', type: 'logux/unsubscribe' })
  await client1.sync({ name: 'C', type: 'name', userId: '1' })

  client1.server.undoNext()
  try {
    await client1.sync({ name: 'D', type: 'name', userId: '1' })
  } catch {}

  expect(client1.log.actions()).toEqual([
    { type: 'default' },
    { id: '1 10:2:2 0', type: 'logux/processed' },
    { name: 'B', type: 'name', userId: '1' },
    { id: '6 10:2:2 0', type: 'logux/processed' },
    { name: 'C', type: 'name', userId: '1' },
    { id: '10 10:2:2 0', type: 'logux/processed' },
    { name: 'D', type: 'name', userId: '1' },
    {
      action: { name: 'D', type: 'name', userId: '1' },
      id: '12 10:2:2 0',
      reason: 'error',
      type: 'logux/undo'
    }
  ])
  expect(client2.log.actions()).toEqual([
    { type: 'default' },
    { channel: 'users/1', type: 'logux/subscribe' },
    { name: 'A', type: 'name', userId: '1' },
    { id: '3 20:3:3 0', type: 'logux/processed' },
    { name: 'B', type: 'name', userId: '1' },
    { channel: 'users/1', type: 'logux/unsubscribe' },
    { id: '8 20:3:3 0', type: 'logux/processed' }
  ])
})

it('supports subprotocols', async () => {
  let client1 = new TestClient('10')
  let client2 = new TestClient('20', {
    server: client1.server,
    subprotocol: 10
  })
  client1.log.keepActions()
  client2.log.keepActions()
  await Promise.all([client1.connect(), client2.connect()])

  await client1.sync({ type: 'client1' })
  await client2.sync({ type: 'client2' })
  await delay(1)

  expect(client1.log.actions()).toEqual([
    { type: 'client1' },
    { id: '1 10:2:2 0', type: 'logux/processed' },
    { type: 'client2' }
  ])
  expect(client1.log.entries()[2][1].subprotocol).toBe(10)

  expect(client2.log.actions()).toEqual([
    { type: 'client1' },
    { type: 'client2' },
    { id: '3 20:3:3 0', type: 'logux/processed' }
  ])
  expect(client2.log.entries()[0][1].subprotocol).toBe(0)
})

it('freezes processing', async () => {
  let client = new TestClient('10')
  client.log.keepActions()
  await client.connect()
  await client.server.freezeProcessing(async () => {
    await client.log.add({ type: 'test' }, { sync: true })
    await delay(10)
    expect(client.log.actions()).toEqual([{ type: 'test' }])
  })
  expect(client.log.actions()).toEqual([
    { type: 'test' },
    { id: '1 10:2:2 0', type: 'logux/processed' }
  ])
})

it('supports subscribed action', async () => {
  let client = new TestClient('10')
  await client.connect()
  await client.server.sendAll({ channel: 'A', type: 'logux/subscribed' })
  await client.sync({ channel: 'A', type: 'logux/unsubscribe' })
})

it('allows subscribing to the same channel with multiple filters', async () => {
  let client = new TestClient('10')
  await client.connect()
  await client.sync({
    channel: 'nodes',
    filter: {
      projectId: 'project0'
    },
    type: 'logux/subscribe'
  })
  await client.sync({
    channel: 'nodes',
    filter: {
      projectId: 'project1'
    },
    type: 'logux/subscribe'
  })
  client.log.keepActions()
  await client.sync({
    channel: 'nodes',
    filter: {
      projectId: 'project0'
    },
    type: 'logux/unsubscribe'
  })
  await client.sync({
    channel: 'nodes',
    filter: {
      projectId: 'project1'
    },
    type: 'logux/unsubscribe'
  })
  expect(client.log.actions()).toEqual([
    {
      channel: 'nodes',
      filter: {
        projectId: 'project0'
      },
      type: 'logux/unsubscribe'
    },
    {
      id: '5 10:2:2 0',
      type: 'logux/processed'
    },
    {
      channel: 'nodes',
      filter: {
        projectId: 'project1'
      },
      type: 'logux/unsubscribe'
    },
    {
      id: '7 10:2:2 0',
      type: 'logux/processed'
    }
  ])
})
