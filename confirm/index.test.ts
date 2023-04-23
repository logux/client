import { it, expect, beforeEach } from 'vitest'
import { spyOn, restoreAll } from 'nanospy'
import { TestPair } from '@logux/core'

import { CrossTabClient, confirm } from '../index.js'

function setState(client: any, state: string): void {
  client.node.setState(state)
}

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

async function createClient(): Promise<CrossTabClient> {
  let pair = new TestPair()

  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: '10'
  })

  client.node.catch(() => true)
  client.role = 'leader'

  await pair.left.connect()
  return client
}

let beforeunloader: false | ((event?: any) => string)
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
    client.log.add({ type: 'logux/subscribe' }, { sync: true, reasons: ['t'] }),
    client.log.add(
      { type: 'logux/unsubscribe' },
      { sync: true, reasons: ['t'] }
    )
  ])
  expect(beforeunloader).toBe(false)

  await client.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
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
  await client.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })

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

  await client.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
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
  await client.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  expect(beforeunloader).toBe(false)
})
