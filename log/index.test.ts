import { TestPair, TestTime, TestLog } from '@logux/core'
import { yellow, bold } from 'chalk'

import { CrossTabClient, ClientMeta, log } from '..'

function setState (client: any, state: string) {
  client.node.setState(state)
}

function emit (obj: any, event: string, ...args: any[]) {
  obj.emitter.emit(event, ...args)
}

function privateMethods (obj: object): any {
  return obj
}

async function createClient () {
  let pair = new TestPair()
  privateMethods(pair.left).url = 'ws://example.com'
  let client = new CrossTabClient<{}, TestLog<ClientMeta>>({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: '10',
    time: new TestTime()
  })

  client.role = 'leader'
  client.node.catch(() => {})

  await pair.left.connect()
  return client
}

let group = false
let out = ''

function format (...args: (string | object)[]): string {
  return (
    (group ? '  ' : '') +
    args
      .filter(i => {
        if (typeof i === 'string') {
          return i !== '' && !i.includes('font-weight:')
        } else {
          return true
        }
      })
      .map(i => {
        if (typeof i === 'string') {
          return i
            .replace(/%cLogux%c/, yellow(bold('Logux')))
            .replace(/%c([^%]+)(%c)?/g, bold('$1'))
        } else {
          return JSON.stringify(i)
        }
      })
      .join(' ')
  )
}

beforeAll(() => {
  jest.spyOn(console, 'groupCollapsed').mockImplementation((...args: any[]) => {
    console.log(...args)
    group = true
  })
  jest.spyOn(console, 'groupEnd').mockImplementation(() => {
    group = false
  })
  jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
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
      type: 'logux/undo',
      id: '1 10:1:1 0',
      reason: 'error'
    },
    { id: '1 server:uuid 0' }
  )

  await client.node.log.add(
    { type: 'logux/subscribe', channel: 'users' },
    { sync: true }
  )
  setState(client, 'sending')
  setState(client, 'synchronized')
  await client.node.log.add(
    {
      type: 'logux/processed',
      id: '2 10:1:1 0'
    },
    { id: '2 server:uuid 0' }
  )

  client.node.connected = false
  setState(client, 'disconnected')

  setState(client, 'connecting')
  client.node.connected = true
  setState(client, 'synchronized')

  await client.node.log.add(
    { type: 'logux/subscribe', channel: 'users', since: 1 },
    { sync: true }
  )
  setState(client, 'sending')
  setState(client, 'synchronized')
  await client.node.log.add(
    {
      type: 'logux/undo',
      id: '3 10:1:1 0',
      reason: 'error',
      wrongProp: 'sync'
    },
    { id: '3 server:uuid 0' }
  )
  await client.node.log.add(
    { type: 'logux/unsubscribe', channel: 'users' },
    { sync: true }
  )
  await client.node.log.add(
    {
      type: 'logux/unsubscribe',
      channel: 'users',
      bad: true
    },
    { sync: true }
  )

  await client.node.log.add(
    {
      type: 'logux/processed',
      id: '200 10:1:1 0'
    },
    { id: '4 server:uuid 0' }
  )

  await client.node.log.add(
    {
      type: 'logux/undo',
      id: '201 10:1:1 0',
      reason: 'error'
    },
    { id: '5 server:uuid 0' }
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

  expect(out).toEqual('')
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

  await client.node.log.add({ type: 'A' }, { tab: 'X', reasons: ['test'] })
  await client.node.log.removeReason('test')

  expect(out).toEqual('')
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
