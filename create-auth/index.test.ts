import { getValue } from 'nanostores'
import { delay } from 'nanodelay'

import { TestClient } from '../index.js'
import { createAuth } from './index.js'

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

function getEventsCount(obj: any, event: string): number {
  return obj.emitter.events[event]?.length || 0
}

it('returns the state of authentication', async () => {
  let client = new TestClient('10')
  let auth = createAuth(client)

  expect(getValue(auth).userId).toBe('10')
  expect(getValue(auth).isAuthenticated).toBe(false)

  await client.connect()
  expect(getValue(auth).isAuthenticated).toBe(true)
})

it('switches loading state on connect', async () => {
  let client = new TestClient('10')
  client.connect()

  let auth = createAuth(client)

  expect(getValue(auth).userId).toBe('10')
  expect(getValue(auth).isAuthenticated).toBe(false)

  await auth.loading
  expect(getValue(auth).isAuthenticated).toBe(true)
})

it('switches loading state on catch error', async () => {
  let client = new TestClient('10')
  let auth = createAuth(client)

  expect(getValue(auth).isAuthenticated).toBe(false)

  emit(client.node, 'error', { type: 'wrong-credentials' })
  await auth.loading
  expect(getValue(auth).isAuthenticated).toBe(false)
})

it('change state on wrong credentials', async () => {
  let client = new TestClient('10')
  let auth = createAuth(client)

  await client.connect()
  expect(getValue(auth).isAuthenticated).toBe(true)

  emit(client.node, 'error', { type: 'wrong-credentials' })
  await delay(1)
  expect(getValue(auth).isAuthenticated).toBe(false)
})

it('doesn’t change state on disconnection', async () => {
  let client = new TestClient('10')
  let auth = createAuth(client)

  await client.connect()
  expect(getValue(auth).isAuthenticated).toBe(true)

  client.disconnect()
  await delay(1)
  expect(getValue(auth).isAuthenticated).toBe(true)
})

it('updates user id after user change', async () => {
  let client = new TestClient('10')
  let auth = createAuth(client)

  await client.connect()
  expect(getValue(auth).userId).toBe('10')

  client.changeUser('20', 'token')
  await delay(1)
  expect(getValue(auth).userId).toBe('20')
})

it('unbinds client events', async () => {
  let client = new TestClient('10')
  let auth = createAuth(client)

  expect(getEventsCount(client, 'user')).toBe(0)
  expect(getEventsCount(client.node, 'error')).toBe(0)
  expect(getEventsCount(client.node, 'state')).toBe(1)

  let destroy = auth.listen(() => {})
  expect(getValue(auth).isAuthenticated).toBe(false)
  expect(getEventsCount(client, 'user')).toBe(1)
  expect(getEventsCount(client.node, 'error')).toBe(1)
  expect(getEventsCount(client.node, 'state')).toBe(2)

  await client.connect()
  expect(getValue(auth).isAuthenticated).toBe(true)
  expect(getEventsCount(client.node, 'state')).toBe(1)

  emit(client.node, 'error', { type: 'wrong-credentials' })
  await delay(1)
  expect(getValue(auth).isAuthenticated).toBe(false)
  expect(getEventsCount(client.node, 'state')).toBe(2)

  destroy()
  await delay(1000)
  expect(getEventsCount(client, 'user')).toBe(0)
  expect(getEventsCount(client.node, 'error')).toBe(0)
  expect(getEventsCount(client.node, 'state')).toBe(1)
})
