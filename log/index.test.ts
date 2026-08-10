import { type TestLog, TestPair, TestTime } from '@logux/core'
import { spyOn } from 'nanospy'
import { styleText } from 'node:util'
import { beforeAll, beforeEach, expect, it } from 'vitest'

import { type ClientMeta, CrossTabClient, log } from '../index.js'

function setState(client: any, state: string): void {
  client.node.setState(state)
}

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

function privateMethods(obj: object): any {
  return obj
}

async function createClient(): Promise<
  CrossTabClient<object, TestLog<ClientMeta>>
> {
  let pair = new TestPair()
  privateMethods(pair.left).url = 'ws://example.com'
  let client = new CrossTabClient<object, TestLog<ClientMeta>>({
    server: pair.left,
    subprotocol: 10,
    time: new TestTime(),
    userId: '10'
  })

  client.role = 'leader'
  client.node.catch(() => {})

  await pair.left.connect()
  return client
}

let group = false
let out = ''

function style(name: 'bold' | 'green' | 'red' | 'yellow') {
  return (text: string): string =>
    styleText(name, text, { validateStream: false })
}

let bold = style('bold')
let green = style('green')
let red = style('red')
let yellow = style('yellow')

function format(...args: (object | string)[]): string {
  let color = (s: string): string => s
  let logoColor = yellow
  return (
    (group ? '  ' : '') +
    args
      .filter(i => {
        if (typeof i === 'string') {
          if (i === '') {
            return false
          } else if (i.includes('color:')) {
            if (i.includes('#c00000')) {
              logoColor = red
              color = red
            } else if (i.includes('#008000')) {
              color = green
            }
            return false
          } else if (i.includes('font-weight:')) {
            return false
          } else {
            return true
          }
        } else {
          return true
        }
      })
      .map(i => {
        if (typeof i === 'string') {
          return i
            .replace(/%cLogux%c/, logoColor(bold('Logux')))
            .replace(/%c([^%]+)(%c)?/g, color(bold('$1')))
        } else {
          return JSON.stringify(i)
        }
      })
      .join(' ')
  )
}

beforeAll(() => {
  spyOn(console, 'groupCollapsed', (...args: any[]) => {
    console.log(...args)
    group = true
  })
  spyOn(console, 'groupEnd', () => {
    group = false
  })
  spyOn(console, 'log', (...args: any[]) => {
    out += format(...args) + '\n'
  })
})

beforeEach(() => {
  out = ''
})

it('prints log', async () => {
  let client = await createClient()
  client.node.connected = false
  setState(client, 'disconnected')
  log(client)

  emit(client, 'role')
  setState(client, 'connecting')

  client.node.remoteNodeId = 'server:uuid'
  client.node.connected = true
  setState(client, 'synchronized')

  await client.node.log.add({ type: 'A' }, { sync: true })
  setState(client, 'sending')
  setState(client, 'synchronized')
  await client.node.log.add(
    {
      action: { type: 'A' },
      id: '0 10:1:1',
      reason: 'error',
      type: 'logux/undo'
    },
    { id: '0 server:uuid' }
  )

  await client.node.log.add(
    { channel: 'users', type: 'logux/subscribe' },
    { id: 'zy 10:1:1', sync: true }
  )
  setState(client, 'sending')
  setState(client, 'synchronized')
  await client.node.log.add(
    { channel: 'users/1', type: 'logux/subscribed' },
    { sync: true }
  )
  await client.node.log.add({ type: 'A' }, { id: '1 server:uuid', sync: true })
  await client.node.log.add(
    {
      id: 'zy 10:1:1',
      type: 'logux/processed'
    },
    { id: '6 server:uuid' }
  )

  client.node.connected = false
  setState(client, 'disconnected')

  setState(client, 'connecting')
  client.node.connected = true
  setState(client, 'synchronized')

  await client.node.log.add(
    { channel: 'users', since: 1, type: 'logux/subscribe' },
    { sync: true }
  )
  setState(client, 'sending')
  setState(client, 'synchronized')
  await client.node.log.add(
    {
      action: { channel: 'users', since: 1, type: 'logux/subscribe' },
      id: '2 10:1:1',
      reason: 'error',
      type: 'logux/undo',
      wrongProp: 'sync'
    },
    { id: '2 server:uuid' }
  )
  await client.node.log.add(
    { channel: 'users', type: 'logux/unsubscribe' },
    { sync: true }
  )
  await client.node.log.add(
    {
      bad: true,
      channel: 'users',
      type: 'logux/unsubscribe'
    },
    { sync: true }
  )

  await client.node.log.add({ type: 'B' }, { id: '6 10:1:1', sync: true })
  setState(client, 'sending')
  setState(client, 'synchronized')
  await client.node.log.add(
    {
      id: '6 10:1:1',
      type: 'logux/processed'
    },
    { id: '5 server:uuid' }
  )

  await client.node.log.add(
    {
      id: '27 10:1:1',
      type: 'logux/processed'
    },
    { id: '3 server:uuid' }
  )

  await client.node.log.add(
    {
      action: { type: 'B' },
      id: '28 10:1:1',
      reason: 'error',
      type: 'logux/undo'
    },
    { id: '4 server:uuid' }
  )

  client.nodeId = '20:2:2'
  emit(client, 'user', '20')

  expect(out).toMatchSnapshot()
})

it('returns unbind function', async () => {
  let client = await createClient()
  let unbind = log(client)

  unbind()
  emit(client, 'role')

  expect(out).toBe('')
})

it('supports cross-tab synchronization', async () => {
  let client = await createClient()
  client.role = 'follower'
  log(client)

  emit(client, 'role')
  client.state = 'connecting'
  emit(client, 'state')

  expect(out).toMatchSnapshot()
})

it('ignores different tab actions', async () => {
  let client = await createClient()
  log(client)

  await client.node.log.add({ type: 'A' }, { reasons: ['test'], tab: 'X' })
  await client.node.log.removeReason('test')

  expect(out).toBe('')
})

it('ignores actions by request', async () => {
  let client = await createClient()
  log(client, { ignoreActions: ['A', 'B'] })

  await Promise.all([
    client.node.log.add({ type: 'A' }, { reasons: ['test'] }),
    client.node.log.add({ type: 'B' })
  ])
  await client.node.log.removeReason('test')
  await client.node.log.add({ type: 'C' })

  expect(out).toMatchSnapshot()
})
