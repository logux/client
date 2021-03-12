import { TextEncoder, TextDecoder } from 'util'
import { TestTime, TestPair } from '@logux/core'
import { Crypto } from '@peculiar/webcrypto'
import { delay } from 'nanodelay'

import { Client, encryptActions } from '../index.js'

global.crypto = new Crypto()
global.TextEncoder = TextEncoder
// @ts-expect-error
global.TextDecoder = TextDecoder

function privateMethods(obj: object): any {
  return obj
}

function getPair(client: Client): TestPair {
  return privateMethods(client.node.connection).pair
}

const BASE64 = expect.stringMatching(/^[\w+/]+=?=?$/)

function createClient(): Client {
  let pair = new TestPair()
  let client = new Client({
    subprotocol: '1.0.0',
    userId: '10',
    server: pair.left,
    time: new TestTime()
  })
  client.on('preadd', (action, meta) => {
    meta.reasons.push('test')
  })
  return client
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
      { type: '0', d: BASE64, iv: BASE64 },
      { id: 1, time: expect.any(Number) }
    ]
  ])

  getPair(client2).right.send(getPair(client1).leftSent[0])
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
  expect(getPair(client1).leftSent).toMatchObject([
    [
      'sync',
      1,
      { type: '0', d: BASE64, iv: BASE64 },
      { id: 1, time: expect.any(Number) }
    ],
    ['sync', 2, { type: 'server' }, { id: 2, time: expect.any(Number) }]
  ])

  getPair(client2).right.send(getPair(client1).leftSent[0])
  getPair(client2).right.send(getPair(client1).leftSent[1])
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
      { type: '0/clean', id: meta.id },
      { id: 2, time: expect.any(Number) }
    ]
  ])
})
