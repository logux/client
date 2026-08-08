import { TestPair, TestTime, WsBinaryConnection } from '@logux/core'
import { delay } from 'nanodelay'
import { TextDecoder, TextEncoder } from 'node:util'
import { afterEach, expect, it } from 'vitest'

import { Client, encryptActions } from '../index.js'
import { getRandomSpaces } from './index.js'

window.TextEncoder = TextEncoder
window.TextDecoder = TextDecoder

function privateMethods(obj: unknown): any {
  return obj
}

function getPair(client: Client): TestPair {
  return privateMethods(client.node.connection).pair
}

function deviation(array: Record<any, number>, runs: number): number {
  let values = Object.values(array)
  return (values.length * (Math.max(...values) - Math.min(...values))) / runs
}

const BYTES = expect.any(Uint8Array)

function createClient(): Client {
  let pair = new TestPair()
  let client = new Client({
    server: pair.left,
    subprotocol: 10,
    time: new TestTime(),
    userId: '10'
  })
  client.on('preadd', (action, meta) => {
    meta.reasons.push('test')
  })
  return client
}

let waiting: Record<string, FakeWebSocket> = {}
let originWebSocket = global.WebSocket

afterEach(() => {
  waiting = {}
  global.WebSocket = originWebSocket
})

/**
 * Two sockets with the same URL become the ends of the same wire.
 */
class FakeWebSocket {
  binaryType = 'blob'
  onclose: (() => void) | undefined
  onerror: ((event: unknown) => void) | undefined
  onmessage: ((event: { data: unknown }) => void) | undefined
  onopen: (() => void) | undefined
  OPEN = 1
  peer: FakeWebSocket | undefined
  readyState = 1

  constructor(url: string) {
    let other = waiting[url]
    if (other) {
      this.peer = other
      other.peer = this
      delete waiting[url]
      queueMicrotask(() => {
        this.onopen?.()
        other.onopen?.()
      })
    } else {
      waiting[url] = this
    }
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  send(data: string | Uint8Array): void {
    let peer = this.peer!
    // Real WebSocket gives ArrayBuffer to `binaryType = 'arraybuffer'` client
    let frame = typeof data === 'string' ? data : data.buffer
    queueMicrotask(() => {
      peer.onmessage?.({ data: frame })
    })
  }
}

function createWsClient(server: string): Client {
  let client = new Client({
    server,
    subprotocol: 10,
    time: new TestTime(),
    userId: '10'
  })
  client.on('preadd', (action, meta) => {
    meta.reasons.push('test')
  })
  return client
}

/**
 * Minimal server on the other end of the wire, which speaks
 * the same binary protocol and relays actions to another client.
 */
function createServer(url: string): WsBinaryConnection<FakeWebSocket> {
  let connection = new WsBinaryConnection<FakeWebSocket>(url, FakeWebSocket)
  connection.on('message', message => {
    if (message[0] === 'connect') {
      connection.send(['connected', message[1], 'server', [0, 0], {}])
    } else if (message[0] === 'sync') {
      connection.send(['synced', message[1]])
    }
  })
  return connection
}

async function connect(client: Client): Promise<void> {
  await client.node.connection.connect()
  let pair = getPair(client)
  await pair.wait('right')
  pair.right.send([
    'connected',
    client.node.localProtocol,
    'server',
    [0, 0],
    { token: 'good' }
  ])
  await pair.wait('left')
  await Promise.resolve()
}

it('encrypts and decrypts actions', async () => {
  let client1 = createClient()
  let client2 = createClient()

  encryptActions(client1, 'password')
  encryptActions(client2, 'password')

  await Promise.all([connect(client1), connect(client2)])
  getPair(client1).clear()

  client1.log.add({ type: 'sync', value: 'secret' }, { sync: true })
  await delay(50)
  expect(getPair(client1).leftSent).toMatchObject([
    [
      'sync',
      1,
      { d: BYTES, iv: BYTES, type: '0' },
      { id: 1, time: expect.any(Number) }
    ]
  ])

  getPair(client2).right.send(getPair(client1).leftSent[0]!)
  await delay(100)
  expect(privateMethods(client2.log).actions()).toEqual([
    { type: 'sync', value: 'secret' }
  ])

  client1.log.add({ type: 'sync', value: 'same size' }, { sync: true })
  client1.log.add({ type: 'sync', value: 'same size' }, { sync: true })
  client1.log.add({ type: 'sync', value: 'same size' }, { sync: true })
  client1.log.add({ type: 'sync', value: 'same size' }, { sync: true })
  await delay(100)
  let size1 = privateMethods(getPair(client1).leftSent[1]![2]).d.length
  let size2 = privateMethods(getPair(client1).leftSent[2]![2]).d.length
  let size3 = privateMethods(getPair(client1).leftSent[3]![2]).d.length
  let size4 = privateMethods(getPair(client1).leftSent[4]![2]).d.length
  expect(size1 !== size2 || size1 !== size3 || size1 !== size4).toBeTruthy()
})

it('accepts key', async () => {
  let client1 = createClient()
  let client2 = createClient()

  let key = await crypto.subtle.generateKey(
    {
      length: 256,
      name: 'AES-GCM'
    },
    true,
    ['encrypt', 'decrypt']
  )

  encryptActions(client1, key)
  encryptActions(client2, key)

  await Promise.all([connect(client1), connect(client2)])
  getPair(client1).clear()

  client1.log.add({ type: 'sync', value: 'secret' }, { sync: true })
  await delay(50)
  expect(getPair(client1).leftSent).toMatchObject([
    [
      'sync',
      1,
      { d: BYTES, iv: BYTES, type: '0' },
      { id: 1, time: expect.any(Number) }
    ]
  ])

  getPair(client2).right.send(getPair(client1).leftSent[0]!)
  await delay(10)
  expect(privateMethods(client2.log).actions()).toEqual([
    { type: 'sync', value: 'secret' }
  ])
})

it('ignores specific actions', async () => {
  let client1 = createClient()
  let client2 = createClient()

  encryptActions(client1, 'password', { ignore: ['server'] })
  encryptActions(client2, 'password')

  await Promise.all([connect(client1), connect(client2)])
  getPair(client1).clear()

  client1.log.add({ type: 'sync' }, { sync: true })
  await delay(10)
  client1.log.add({ type: 'server' }, { sync: true })
  await delay(10)
  client1.log.add({ type: 'nonsync' })
  await delay(10)
  expect(getPair(client1).leftSent).toMatchObject([
    [
      'sync',
      1,
      { d: BYTES, iv: BYTES, type: '0' },
      { id: 1, time: expect.any(Number) }
    ],
    ['sync', 2, { type: 'server' }, { id: 2, time: expect.any(Number) }]
  ])

  getPair(client2).right.send(getPair(client1).leftSent[0]!)
  getPair(client2).right.send(getPair(client1).leftSent[1]!)
  await delay(10)
  expect(privateMethods(client2.log).actions()).toEqual([
    { type: 'sync' },
    { type: 'server' }
  ])
})

it('cleans actions on server', async () => {
  let client = createClient()
  encryptActions(client, 'password')
  await connect(client)

  let meta = await client.log.add({ type: 'sync' }, { sync: true })
  if (meta === false) throw new Error('Action was no inserted')
  await delay(10)
  getPair(client).clear()

  await client.log.removeReason('test')
  await client.log.removeReason('syncing')
  await delay(10)
  expect(getPair(client).leftSent).toMatchObject([
    [
      'sync',
      2,
      { id: meta.id, type: '0/clean' },
      { id: 2, time: expect.any(Number) }
    ]
  ])
})

it('has normal distribution of random spaces', () => {
  let sizes: Record<number, number> = {}
  let symbols: Record<string, number> = {}

  for (let i = 0; i < 100000; i++) {
    let spaces = getRandomSpaces()

    if (!sizes[spaces.length]) sizes[spaces.length] = 0
    sizes[spaces.length]! += 1

    for (let symbol of spaces) {
      if (!symbols[symbol]) symbols[symbol] = 0
      symbols[symbol] += 1
    }
  }

  expect(Object.keys(sizes).length).toBe(32)
  expect(Object.keys(symbols).length).toBe(4)

  expect(deviation(sizes, 100000)).toBeLessThan(0.2)
  expect(deviation(symbols, 100000)).toBeLessThan(0.2)
})

it('keeps non-WebSocket connections as is', () => {
  // Like TestClient from Logux Server, which has no Client’s `options`
  let pair = new TestPair()
  let fake = {
    log: { on: () => () => {} },
    node: { connection: pair.left, options: { onSend: () => false } }
  }

  encryptActions(fake as unknown as Client, 'password')

  expect(fake.node.connection).toBe(pair.left)
})

it('sends encrypted actions through binary protocol', async () => {
  global.WebSocket = FakeWebSocket as any

  let client1 = createWsClient('wss://one.test')
  let client2 = createWsClient('wss://two.test')

  encryptActions(client1, 'password')
  encryptActions(client2, 'password')

  let server1 = createServer('wss://one.test')
  let server2 = createServer('wss://two.test')

  let received: any[] = []
  server1.on('message', message => {
    if (message[0] === 'sync') {
      received.push(message[2])
      server2.send(message)
    }
  })

  await Promise.all([
    server1.connect(),
    server2.connect(),
    client1.node.connection.connect(),
    client2.node.connection.connect()
  ])
  await delay(50)

  let long = 'a'.repeat(1000)
  client1.log.add({ type: 'sync', value: 'secret' }, { sync: true })
  client1.log.add({ type: 'sync', value: long }, { sync: true })
  await delay(100)

  // Protocol keeps compression flag in action type byte, not in the object
  expect(received).toEqual([
    { compressed: false, d: BYTES, iv: BYTES, type: '0' },
    { compressed: true, d: BYTES, iv: BYTES, type: '0' }
  ])
  expect(privateMethods(client2.log).actions()).toEqual([
    { type: 'sync', value: 'secret' },
    { type: 'sync', value: long }
  ])

  client1.destroy()
  client2.destroy()
})

it('compresses long actions', async () => {
  let client1 = createClient()
  let client2 = createClient()

  encryptActions(client1, 'password')
  encryptActions(client2, 'password')

  await Promise.all([connect(client1), connect(client2)])
  getPair(client1).clear()

  let long = 'a'.repeat(1000)

  client1.log.add({ type: 'sync', value: long }, { sync: true })
  await delay(100)
  let action = privateMethods(getPair(client1).leftSent[0]![2])
  expect(action.d.length).toBeLessThan(120)
  expect(action.compressed).toBe(true)

  getPair(client2).right.send(getPair(client1).leftSent[0]!)
  await delay(100)
  expect(privateMethods(client2.log).actions()).toEqual([
    { type: 'sync', value: long }
  ])
})
