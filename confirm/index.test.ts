import { TestPair } from '@logux/core'
import { restoreAll, spyOn } from 'nanospy'
import { beforeEach, expect, it } from 'vitest'

import { confirm, CrossTabClient } from '../index.js'

function setState(client: any, state: string): void {
  client.node.setState(state)
}

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

async function createClient(): Promise<CrossTabClient> {
  let pair = new TestPair()

  let client = new CrossTabClient({
    server: pair.left,
    subprotocol: '1.0.0',
    userId: '10'
  })

  client.node.catch(() => true)
  client.role = 'leader'

  await pair.left.connect()
  return client
}

let beforeunloader: ((event?: any) => string) | false
function callBeforeloader(event?: any): string {
  if (beforeunloader === false) {
    throw new Error('beforeunloader was not set')
  } else {
    return beforeunloader(event)
  }
}

beforeEach(() => {
  restoreAll()
  beforeunloader = false

  spyOn(window, 'addEventListener', (event: string, callback: any) => {
    if (event === 'beforeunload') beforeunloader = callback
  })
  spyOn(window, 'removeEventListener', (event: string, callback: any) => {
    if (event === 'beforeunload' && beforeunloader === callback) {
      beforeunloader = false
    }
  })
})

it('confirms close', async () => {
  let client = await createClient()
  confirm(client)

  setState(client, 'disconnected')
  expect(beforeunloader).toBe(false)

  await Promise.all([
    client.log.add({ type: 'logux/subscribe' }, { reasons: ['t'], sync: true }),
    client.log.add(
      { type: 'logux/unsubscribe' },
      { reasons: ['t'], sync: true }
    )
  ])
  expect(beforeunloader).toBe(false)

  await client.log.add({ type: 'A' }, { reasons: ['t'], sync: true })
  expect(callBeforeloader({})).toBe('unsynced')

  setState(client, 'sending')
  let e: any = {}
  callBeforeloader(e)
  expect(e.returnValue).toBe('unsynced')
})

it('does not confirm on synchronized state', async () => {
  let client = await createClient()
  confirm(client)
  setState(client, 'disconnected')
  await client.log.add({ type: 'A' }, { reasons: ['t'], sync: true })

  setState(client, 'synchronized')
  expect(beforeunloader).toBe(false)

  setState(client, 'disconnected')
  expect(beforeunloader).toBe(false)
})

it('does not confirm on follower tab', async () => {
  let client = await createClient()
  confirm(client)

  setState(client, 'disconnected')
  expect(beforeunloader).toBe(false)

  await client.log.add({ type: 'A' }, { reasons: ['t'], sync: true })
  client.role = 'follower'
  emit(client, 'role')
  expect(beforeunloader).toBe(false)
})

it('returns unbind function', async () => {
  let client = await createClient()
  let unbind = confirm(client)
  unbind()
  setState(client, 'disconnected')
  expect(beforeunloader).toBe(false)
  await client.log.add({ type: 'A' }, { reasons: ['t'], sync: true })
  expect(beforeunloader).toBe(false)
})
