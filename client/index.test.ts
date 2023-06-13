import { defineAction } from '@logux/actions'
import {
  type Action,
  MemoryStore,
  type TestLog,
  TestPair,
  TestTime
} from '@logux/core'
import { delay } from 'nanodelay'
import { restoreAll, spyOn } from 'nanospy'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { Client, type ClientOptions } from '../index.js'
import { setLocalStorage } from '../test/local-storage.js'

type Events = {
  [key: string]: (() => void)[]
}

class WebSocket {
  close(): void {}
}

beforeEach(() => {
  global.WebSocket = WebSocket as any
  setLocalStorage()
})

let originIndexedDB = global.indexedDB
afterEach(() => {
  global.indexedDB = originIndexedDB
  restoreAll()
})

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

function getEvents(obj: any): Events {
  return obj.emitter.events
}

function setState(client: any, state: string): void {
  client.node.setState(state)
}

function privateMethods(obj: object): any {
  return obj
}

function toNumber(str: null | string): number {
  if (str === null) {
    throw new Error('Key value is null')
  } else {
    return parseInt(str)
  }
}

function getPair(client: Client): TestPair {
  return privateMethods(client.node.connection).pair
}

async function createDialog(
  opts: Partial<ClientOptions> = {},
  token: string | undefined = undefined
): Promise<Client<{}, TestLog>> {
  let pair = new TestPair()

  let client = new Client<{}, TestLog>({
    server: pair.left,
    subprotocol: '1.0.0',
    time: new TestTime(),
    userId: '10',
    ...opts
  })

  if (typeof opts.server === 'string') {
    let connection = privateMethods(client.node.connection).connection
    let events1 = getEvents(connection)
    let events2 = getEvents(pair.left)
    for (let i in events1) {
      if (typeof events2[i] !== 'undefined') {
        events2[i] = events2[i].concat(events1[i])
      } else {
        events2[i] = events1[i].slice(0)
      }
    }
    client.node.connection = pair.left
  }

  client.on('preadd', (action, meta) => {
    meta.reasons.push('test')
  })

  await client.node.connection.connect()
  await pair.wait('right')
  pair.right.send([
    'connected',
    client.node.localProtocol,
    'server',
    [0, 0],
    { token }
  ])
  await pair.wait('left')
  await Promise.resolve()
  client.node.timeFix = 0
  return client
}

function createClient(): Client<{}, TestLog> {
  let client = new Client<{}, TestLog>({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    time: new TestTime(),
    userId: '10'
  })
  client.node.connection.connect = () => Promise.resolve()
  privateMethods(client).tabPing = 50
  return client
}

it('saves options', () => {
  let client = new Client({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  expect(client.options.subprotocol).toBe('1.0.0')
})

it('throws on missed server', () => {
  expect(() => {
    // @ts-expect-error
    new Client({ subprotocol: '1.0.0', userId: '10' })
  }).toThrow(/server/)
})

it('throws on missed subprotocol', () => {
  expect(() => {
    // @ts-expect-error
    new Client({ server: 'wss://localhost:1337', userId: '10' })
  }).toThrow(/subprotocol/)
})

it('throws on missed user ID', () => {
  expect(() => {
    // @ts-expect-error
    new Client({ server: 'wss://localhost:1337', subprotocol: '1.0.0' })
  }).toThrow(/userId/)
})

it('throws on colon in user ID', () => {
  expect(() => {
    new Client({
      server: 'wss://localhost:1337',
      subprotocol: '1.0.0',
      userId: 'admin:1'
    })
  }).toThrow(/colon/)
})

it('throws on false in user ID', () => {
  expect(() => {
    new Client({
      server: 'wss://localhost:1337',
      subprotocol: '1.0.0',
      // @ts-expect-error
      userId: false
    })
  }).toThrow(/userId: "false"/)
})

it('throws on non-string in user ID', () => {
  expect(() => {
    new Client({
      server: 'wss://localhost:1337',
      subprotocol: '1.0.0',
      // @ts-expect-error
      userId: 10
    })
  }).toThrow(/userId must be a string/)
})

it('not warns on WSS', async () => {
  let error = spyOn(console, 'error', () => {})
  let client = await createDialog()
  expect(client.node.connected).toBe(true)
  expect(error.called).toBe(false)
})

it('forces to use WSS in production domain', async () => {
  let error = spyOn(console, 'error', () => {})
  let client = await createDialog({ server: 'ws://test.com' })
  await delay(10)
  expect(client.node.connected).toBe(false)
  expect(error.calls).toEqual([
    [
      'Without SSL, old proxies block WebSockets. ' +
        'Use WSS for Logux or set allowDangerousProtocol option.'
    ]
  ])
})

it('ignores WS with allowDangerousProtocol', async () => {
  let error = spyOn(console, 'error', () => {})
  let client = await createDialog({
    allowDangerousProtocol: true,
    server: 'ws://test.com'
  })
  expect(client.node.connected).toBe(true)
  expect(error.called).toBe(false)
})

it('ignores WS in development', async () => {
  let error = spyOn(console, 'error', () => {})
  let client = await createDialog(
    {
      server: 'ws://test.com'
    },
    'development'
  )
  expect(client.node.connected).toBe(true)
  expect(error.called).toBe(false)
})

it('uses user ID in node ID', () => {
  let client1 = new Client({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  expect(client1.clientId).toMatch(/^10:[\w-]{8}$/)
  expect(client1.tabId).toMatch(/^[\w-]{8}$/)
  expect(client1.nodeId).toEqual(client1.clientId + ':' + client1.tabId)

  let client2 = new Client({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  expect(client2.nodeId).toEqual(client2.clientId + ':' + client2.tabId)
})

it('uses node ID in ID generator', () => {
  let client = new Client({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    time: new TestTime(),
    userId: '10'
  })
  let id = client.log.generateId()
  expect(id).toContain('1 10:1:1 0')
})

it('uses custom store', () => {
  let store = new MemoryStore()
  let client = new Client({
    server: 'wss://localhost:1337',
    store,
    subprotocol: '1.0.0',
    userId: '10'
  })
  expect(client.log.store).toBe(store)
})

it('sends options to connection', () => {
  let client = new Client({
    attempts: 5,
    maxDelay: 500,
    minDelay: 100,
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  expect(privateMethods(client.node.connection).options).toEqual({
    attempts: 5,
    maxDelay: 500,
    minDelay: 100
  })
  expect(privateMethods(client.node.connection).connection.url).toBe(
    'wss://localhost:1337'
  )
})

it('sends options to node', () => {
  let client = new Client({
    ping: 1000,
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    timeout: 2000,
    token: 'token',
    userId: '10'
  })
  expect(client.node.options.subprotocol).toBe('1.0.0')
  expect(client.node.options.token).toBe('token')
  expect(client.node.options.timeout).toBe(2000)
  expect(client.node.options.ping).toBe(1000)
})

it('uses test time', () => {
  let client = createClient()
  expect(client.log.generateId()).toBe('1 10:1:1 0')
})

it('connects', () => {
  let client = createClient()
  let connect = spyOn(client.node.connection, 'connect')
  client.start()
  expect(connect.callCount).toEqual(1)
})

it('display server debug error stacktrace with prefix', () => {
  let error = spyOn(console, 'error', () => {})
  let client = createClient()
  emit(client.node, 'debug', 'error', 'Fake stacktrace\n')
  expect(error.calls).toEqual([
    ['Error on Logux server:\n', 'Fake stacktrace\n']
  ])
})

it('does not display server debug message if type is not error', () => {
  let error = spyOn(console, 'error', () => {})
  let client = createClient()
  emit(client.node, 'debug', 'notError', 'Fake stacktrace\n')
  expect(error.called).toBe(false)
})

it('cleans everything', async () => {
  let client = createClient()
  let destroy = spyOn(client.node, 'destroy')
  let clean = spyOn(client.log.store, 'clean')
  await client.clean()
  expect(destroy.callCount).toEqual(1)
  expect(clean.callCount).toEqual(1)
})

it('pings after tab-specific action', async () => {
  let client = createClient()
  let id = client.tabId
  client.options.prefix = 'test'
  client.node.connection.connect = () => Promise.resolve()

  client.start()
  let key = 'test:tab:' + id
  expect(localStorage.getItem(key)).toBeNull()

  let prev
  await client.log.add({ type: 'A' }, { reasons: ['tab' + id] })
  expect(localStorage.getItem(key)).toBeDefined()
  prev = localStorage.getItem(key)
  await delay(privateMethods(client).tabPing)
  expect(toNumber(localStorage.getItem(key))).toBeGreaterThan(toNumber(prev))
})

it('cleans own actions on destroy', async () => {
  let client = createClient()
  client.start()
  await client.log.add(
    { type: 'A' },
    { reasons: ['tab' + client.tabId], tab: client.tabId }
  )
  client.destroy()
  await delay(1)
  expect(client.log.actions()).toHaveLength(0)
  expect(localStorage.getItem('test:tab:' + client.tabId)).toBeNull()
})

it('cleans own actions on unload', async () => {
  let client = createClient()
  client.start()
  await client.log.add(
    { type: 'A' },
    { reasons: ['tab' + client.tabId], tab: client.tabId }
  )
  window.dispatchEvent(new Event('unload'))
  await delay(10)
  expect(client.log.actions()).toHaveLength(0)
  expect(localStorage.getItem('test:tab:' + client.tabId)).toBeNull()
})

it('cleans other tab action after timeout', async () => {
  let client = createClient()
  await Promise.all([
    client.log.add({ type: 'A' }, { reasons: ['tab1'], tab: '1' }),
    client.log.add({ type: 'B' }, { reasons: ['tab2'], tab: '2' })
  ])
  let tabTimeout: number = privateMethods(client).tabTimeout
  localStorage.setItem('logux:tab:1', `${Date.now() - tabTimeout - 1}`)
  localStorage.setItem('logux:tab:2', `${Date.now() - tabTimeout + 100}`)
  client.start()
  await delay(1)
  expect(client.log.actions()).toEqual([{ type: 'B' }])
  expect(localStorage.getItem('test:tab:2')).toBeNull()
})

it('adds current subprotocol to meta', async () => {
  let client = createClient()
  await client.log.add({ type: 'A' }, { reasons: ['test'] })
  expect(client.log.entries()[0][1].subprotocol).toBe('1.0.0')
})

it('adds current subprotocol only to own actions', async () => {
  let client = createClient()
  await client.log.add(
    { type: 'A' },
    { id: '1 0:client:other 0', reasons: ['test'] }
  )
  expect(client.log.entries()[0][1].subprotocol).toBeUndefined()
})

it('allows to override subprotocol in meta', async () => {
  let client = createClient()
  await client.log.add(
    { type: 'A' },
    { reasons: ['test'], subprotocol: '0.1.0' }
  )
  expect(client.log.entries()[0][1].subprotocol).toBe('0.1.0')
})

it('sends only special actions', async () => {
  let client = await createDialog()
  let pair = getPair(client)
  pair.clear()
  await Promise.all([
    client.log.add({ type: 'a' }, { id: '1 10:client:uuid 0', sync: true }),
    client.log.add({ type: 'c' }, { id: '2 10:client:uuid 0' })
  ])
  pair.right.send(['synced', 1])
  await client.node.waitFor('synchronized')
  await delay(10)
  expect(pair.leftSent).toEqual([
    ['sync', 1, { type: 'a' }, { id: [1, '10:client:uuid', 0], time: 1 }]
  ])
})

it('filters data before sending', async () => {
  let client = await createDialog({ userId: 'a' })
  let pair = getPair(client)
  pair.clear()
  await Promise.all([
    client.log.add(
      { type: 'a' },
      {
        channels: ['user:0'],
        clients: ['0:client'],
        custom: 1,
        id: '1 a:client:uuid 0',
        nodes: ['0:client:uuid'],
        reasons: ['test'],
        sync: true,
        time: 1,
        users: ['0']
      }
    ),
    client.log.add(
      { type: 'c' },
      {
        id: '1 0:client:uuid 0',
        reasons: ['test'],
        sync: true
      }
    )
  ])
  pair.right.send(['synced', 1])
  await client.node.waitFor('synchronized')
  await delay(10)
  expect(pair.leftSent).toEqual([
    ['sync', 1, { type: 'a' }, { id: [1, 'a:client:uuid', 0], time: 1 }]
  ])
})

it('compresses subprotocol', async () => {
  let client = await createDialog()
  let pair = getPair(client)
  pair.clear()
  await Promise.all([
    client.log.add(
      { type: 'a' },
      {
        id: '1 10:client:id 0',
        reasons: ['test'],
        subprotocol: '1.0.0',
        sync: true
      }
    ),
    client.log.add(
      { type: 'a' },
      {
        id: '2 10:client:id 0',
        reasons: ['test'],
        subprotocol: '2.0.0',
        sync: true
      }
    )
  ])
  pair.right.send(['synced', 1])
  pair.right.send(['synced', 2])
  await client.node.waitFor('synchronized')
  await delay(10)
  expect(pair.leftSent).toEqual([
    ['sync', 1, { type: 'a' }, { id: [1, '10:client:id', 0], time: 1 }],
    [
      'sync',
      2,
      { type: 'a' },
      {
        id: [2, '10:client:id', 0],
        subprotocol: '2.0.0',
        time: 2
      }
    ]
  ])
})

it('keeps synced actions before synchronization', async () => {
  let client = createClient()
  await Promise.all([
    client.log.add({ type: 'A' }, { sync: true }),
    client.log.add({ type: 'B' }, { sync: true })
  ])
  expect(client.log.actions()).toEqual([{ type: 'A' }, { type: 'B' }])
  await Promise.all([
    client.log.add({ id: '1 10:1:1 0', type: 'logux/processed' }),
    client.log.add({ id: '2 10:1:1 0', type: 'logux/undo' })
  ])
  expect(client.log.actions()).toHaveLength(0)
})

it('resubscribes to previous subscriptions', async () => {
  let client = createClient()
  let added: Action[] = []
  client.on('preadd', action => {
    if (action.type === 'logux/subscribe') {
      added.push(action)
    }
  })
  setState(client, 'synchronized')
  await Promise.all([
    client.log.add({ channel: 'a', type: 'logux/subscribe' }, { sync: true }),
    client.log.add({ channel: 'a', type: 'logux/subscribe' }, { sync: true }),
    client.log.add(
      { b: 1, channel: 'b', type: 'logux/subscribe' },
      { sync: true }
    ),
    client.log.add(
      { b: 2, channel: 'b', type: 'logux/subscribe' },
      { sync: true }
    ),
    client.log.add(
      { b: 2, channel: 'b', type: 'logux/subscribe' },
      { sync: true }
    ),
    client.log.add(
      { b: 1, channel: 'b', type: 'logux/unsubscribe' },
      { sync: true }
    ),
    client.log.add(
      { b: 2, channel: 'b', type: 'logux/unsubscribe' },
      { sync: true }
    )
  ])
  added = []

  client.log.add({ id: '1 10:1:1 0', type: 'logux/processed' })
  client.log.add({ id: '2 10:1:1 0', type: 'logux/processed' })
  client.log.add({ id: '3 10:1:1 0', type: 'logux/processed' })
  client.log.add({ id: '4 10:1:1 0', type: 'logux/processed' })
  client.log.add({ id: '5 10:1:1 0', type: 'logux/processed' })
  client.log.add({ id: '6 10:1:1 0', type: 'logux/processed' })
  client.log.add({ id: '7 10:1:1 0', type: 'logux/processed' })
  await delay(1)
  expect(client.log.actions()).toHaveLength(0)

  setState(client, 'sending')
  setState(client, 'synchronized')
  expect(added).toHaveLength(0)

  setState(client, 'disconnected')
  setState(client, 'connecting')
  setState(client, 'synchronized')
  expect(added).toEqual([
    {
      channel: 'a',
      since: { id: '9 10:1:1 0', time: 9 },
      type: 'logux/subscribe'
    },
    {
      b: 2,
      channel: 'b',
      since: { id: '12 10:1:1 0', time: 12 },
      type: 'logux/subscribe'
    }
  ])

  expect(client.log.actions()).toHaveLength(0)
})

it('does not subscribing twice during connection', async () => {
  let client = createClient()
  let added: Action[] = []
  client.on('preadd', action => {
    if (action.type === 'logux/subscribe') {
      added.push(action)
    }
  })
  setState(client, 'connecting')
  setState(client, 'sending')
  await client.log.add(
    { channel: 'a', type: 'logux/subscribe' },
    { sync: true }
  )
  added = []
  setState(client, 'synchronized')
  expect(added).toEqual([])
})

it('tells last action time during resubscription', async () => {
  let client = createClient()
  let added: Action[] = []
  client.on('preadd', action => {
    if (action.type === 'logux/subscribe') {
      added.push(action)
    }
  })
  setState(client, 'synchronized')
  await Promise.all([
    client.log.add({ channel: 'a', type: 'logux/subscribe' }, { sync: true }),
    client.log.add({ channel: 'b', type: 'logux/subscribe' }, { sync: true })
  ])
  added = []
  await Promise.all([
    client.log.add({ id: '1 10:1:1 0', type: 'logux/processed' }),
    client.log.add({ id: '2 10:1:1 0', type: 'logux/processed' }),
    client.log.add({ type: 'A' }, { channels: ['a'], id: '8 10:2:1 0' }),
    client.log.add({ type: 'B' }, { channels: ['b'], id: '0 10:2:1 0' }),
    client.log.add({ type: 'A' }, { channels: ['a'], id: '9 10:1:1 0' })
  ])
  setState(client, 'disconnected')
  setState(client, 'connecting')
  setState(client, 'synchronized')
  expect(added).toEqual([
    {
      channel: 'a',
      since: { id: '8 10:2:1 0', time: 8 },
      type: 'logux/subscribe'
    },
    {
      channel: 'b',
      since: { id: '4 10:1:1 0', time: 4 },
      type: 'logux/subscribe'
    }
  ])
})

it('changes user ID', async () => {
  let client = await createDialog()
  let pair = getPair(client)
  let users: string[] = []
  client.on('user', userId => {
    users.push(userId)
  })
  client.changeUser('20', 'token')
  expect(users).toEqual(['20'])
  expect(client.node.state).toBe('connecting')
  pair.right.send(['connected', client.node.localProtocol, 'server', [0, 0]])
  await client.node.waitFor('synchronized')
})

it('changes user ID of disconnected node', async () => {
  let client = await createDialog()
  client.node.connection.disconnect()
  client.changeUser('20', 'token')
  let clientId = client.clientId.split(':')[1]
  expect(client.node.localNodeId).toEqual(`20:${clientId}:1`)
  expect(client.node.state).toBe('disconnected')
  let meta = await client.log.add({ type: 'test' })
  if (meta === false) throw new Error('Action was not found')
  expect(meta.id).toContain(` 20:${clientId}:1 `)
})

it('checks user ID during changing', async () => {
  let client = await createDialog()
  expect(() => {
    // @ts-expect-error
    client.changeUser(20, 'token')
  }).toThrow(/userId must be a string/)
  expect(() => {
    client.changeUser('admin:20', 'token')
  }).toThrow(/colon/)
})

it('has type listeners', async () => {
  let client = await createDialog()
  let events: [string, string][] = []

  let unbindAdd = client.type('A', action => {
    events.push(['add A', action.type])
  })
  client.type(
    'A',
    action => {
      events.push(['preadd A', action.type])
    },
    { event: 'preadd' }
  )

  await client.log.add({ type: 'A' })
  await client.log.add({ type: 'B' })
  await client.log.add({ type: 'A' })
  unbindAdd()
  await client.log.add({ type: 'A' })

  expect(events).toEqual([
    ['preadd A', 'A'],
    ['add A', 'A'],
    ['preadd A', 'A'],
    ['add A', 'A'],
    ['preadd A', 'A']
  ])
})

it('has type listeners for action creator', async () => {
  let client = await createDialog()
  let events: [string, string][] = []
  let aAction = defineAction('A')

  let unbindAdd = client.type(aAction, action => {
    events.push(['add A', action.type])
  })
  client.type(
    aAction,
    action => {
      events.push(['preadd A', action.type])
    },
    { event: 'preadd' }
  )

  await client.log.add({ type: 'A' })
  await client.log.add({ type: 'B' })
  await client.log.add({ type: 'A' })
  unbindAdd()
  await client.log.add({ type: 'A' })

  expect(events).toEqual([
    ['preadd A', 'A'],
    ['add A', 'A'],
    ['preadd A', 'A'],
    ['add A', 'A'],
    ['preadd A', 'A']
  ])
})

it('tracks server processing of action', async () => {
  let client = await createDialog()

  let result = 'none'
  client
    .sync({ type: 'logux/subscribe' })
    .then(meta => {
      expect(typeof meta.id).toBe('string')
      result = 'processed'
    })
    .catch(() => {
      result = 'error'
    })

  expect(result).toBe('none')
  expect(client.log.entries()[0][1].sync).toBe(true)
  let id = client.log.entries()[0][1].id
  client.log.add({ id, type: 'logux/processed' })
  await delay(10)

  expect(result).toBe('processed')
})

it('tracks server error of action', async () => {
  let client = await createDialog()

  let result = 'none'
  client
    .sync({ type: 'A' }, { id: '2 10:1:1 0', reasons: ['test'] })
    .then(() => {
      result = 'processed'
    })
    .catch(e => {
      expect(e.name).toBe('LoguxUndoError')
      expect(e.message).toBe('Server undid action because of test')
      expect(e.action.type).toBe('logux/undo')
      result = 'error'
    })

  expect(result).toBe('none')
  client.log.add({ id: '2 10:1:1 0', reason: 'test', type: 'logux/undo' })
  await delay(10)

  expect(result).toBe('error')
})

it('copies state from node', async () => {
  let client = await createDialog()

  let events: string[] = []
  client.on('state', () => {
    events.push(client.state)
  })

  expect(client.state).toBe('connecting')
  expect(client.connected).toBe(false)

  await delay(10)
  expect(client.state).toBe('synchronized')
  expect(client.connected).toBe(true)
  await client.waitFor('synchronized')

  delay(100).then(() => {
    client.node.connection.disconnect()
  })
  await client.waitFor('disconnected')
  expect(client.connected).toBe(false)
  expect(events).toEqual(['synchronized', 'disconnected'])
})

it('works with unsubscribe in offline', async () => {
  let client = await createDialog()
  let pair = privateMethods(client.node.connection).pair
  client.on('preadd', (action, meta) => {
    meta.reasons = meta.reasons.filter(i => i !== 'test')
  })

  async function subscribe(channel: string, filter?: object): Promise<void> {
    await client.log.add(
      { channel, filter, type: 'logux/subscribe' },
      { sync: true }
    )
  }
  async function unsubscribe(channel: string, filter?: object): Promise<void> {
    await client.log.add(
      { channel, filter, type: 'logux/unsubscribe' },
      { sync: true }
    )
  }

  await subscribe('A')
  await subscribe('B', { id: 1 })
  await subscribe('B', { id: 2 })

  await delay(1)
  await client.log.add({ id: '1 10:1:1 0', type: 'logux/processed' })
  await client.log.add({ id: '2 10:1:1 0', type: 'logux/processed' })
  await client.log.add({ id: '3 10:1:1 0', type: 'logux/processed' })
  client.node.connection.disconnect()

  await subscribe('C')
  await subscribe('D')
  await subscribe('B', { id: 3 })
  await delay(1)

  await unsubscribe('C')
  await unsubscribe('B', { id: 2 })
  await unsubscribe('B', { id: 3 })

  pair.clear()
  await client.node.connection.connect()
  await pair.wait('right')
  pair.right.send([
    'connected',
    client.node.localProtocol,
    'server',
    [0, 0],
    {}
  ])
  await pair.wait('left')
  setState(client, 'synchronized')
  await delay(10)

  expect(pair.leftSent).toEqual([
    [
      'connect',
      client.node.localProtocol,
      '10:1:1',
      0,
      { subprotocol: '1.0.0' }
    ],
    [
      'sync',
      3,
      {
        channel: 'A',
        since: {
          id: '4 10:1:1 0',
          time: 4
        },
        type: 'logux/subscribe'
      },
      { id: 13, time: 13 }
    ],
    [
      'sync',
      3,
      {
        channel: 'B',
        filter: { id: 1 },
        since: {
          id: '6 10:1:1 0',
          time: 6
        },
        type: 'logux/subscribe'
      },
      { id: 14, time: 14 }
    ],
    [
      'sync',
      6,
      { channel: 'D', filter: undefined, type: 'logux/subscribe' },
      { id: 8, time: 8 },
      { channel: 'B', filter: { id: 3 }, type: 'logux/subscribe' },
      { id: 9, time: 9 }
    ]
  ])
})
