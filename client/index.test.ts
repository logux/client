import { MemoryStore, TestPair, TestTime, TestLog, Action } from '@logux/core'
import { delay } from 'nanodelay'

import { Client, ClientOptions } from '..'

type Events = {
  [key: string]: (() => void)[]
}

beforeEach(() => {
  Object.defineProperty(global, '_localStorage', {
    value: {
      storage: {},
      setItem (key: string, value: string) {
        this[key] = value
        this.storage[key] = value
      },
      getItem (key: string) {
        return this.storage[key]
      },
      removeItem (key: string) {
        delete this[key]
        delete this.storage[key]
      }
    }
  })
})

let originIndexedDB = global.indexedDB
afterEach(() => {
  global.indexedDB = originIndexedDB
  jest.clearAllMocks()
})

function emit (obj: any, event: string, ...args: any[]) {
  obj.emitter.emit(event, ...args)
}

function getEvents (obj: any): Events {
  return obj.emitter.events
}

function setState (client: any, state: string) {
  client.node.setState(state)
}

function privateMethods (obj: object): any {
  return obj
}

function toNumber (str: string | null): number {
  if (str === null) {
    throw new Error('Key value is null')
  } else {
    return parseInt(str)
  }
}

function getPair (client: Client): TestPair {
  return privateMethods(client.node.connection).pair
}

async function createDialog (
  opts: Partial<ClientOptions> = {},
  token?: string
) {
  let pair = new TestPair()

  let client = new Client({
    subprotocol: '1.0.0',
    userId: '10',
    server: pair.left,
    time: new TestTime(),
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
  if (client.node.connected) {
    await client.node.waitFor('synchronized')
  }
  client.node.timeFix = 0
  return client
}

function createClient () {
  let client = new Client<{}, TestLog>({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10',
    time: new TestTime()
  })
  client.node.connection.connect = () => Promise.resolve()
  privateMethods(client).tabPing = 50
  return client
}

it('saves options', () => {
  let client = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  expect(client.options.subprotocol).toEqual('1.0.0')
})

it('throws on missed server', () => {
  expect(() => {
    // @ts-expect-error
    new Client({ userId: '10', subprotocol: '1.0.0' })
  }).toThrow(/server/)
})

it('throws on missed subprotocol', () => {
  expect(() => {
    // @ts-expect-error
    new Client({ userId: '10', server: 'wss://localhost:1337' })
  }).toThrow(/subprotocol/)
})

it('throws on missed user ID', () => {
  expect(() => {
    // @ts-expect-error
    new Client({ subprotocol: '1.0.0', server: 'wss://localhost:1337' })
  }).toThrow(/userId/)
})

it('throws on colon in user ID', () => {
  expect(() => {
    new Client({
      subprotocol: '1.0.0',
      server: 'wss://localhost:1337',
      userId: 'admin:1'
    })
  }).toThrow(/colon/)
})

it('throws on false in user ID', () => {
  expect(() => {
    new Client({
      subprotocol: '1.0.0',
      server: 'wss://localhost:1337',
      // @ts-expect-error
      userId: false
    })
  }).toThrow(/userId: "false"/)
})

it('throws on non-string in user ID', () => {
  expect(() => {
    new Client({
      subprotocol: '1.0.0',
      server: 'wss://localhost:1337',
      // @ts-expect-error
      userId: 10
    })
  }).toThrow(/userId must be a string/)
})

it('not warns on WSS', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let client = await createDialog()
  expect(client.node.connected).toBe(true)
  expect(console.error).not.toHaveBeenCalledWith()
})

it('forces to use WSS in production domain', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let client = await createDialog({ server: 'ws://test.com' })
  expect(client.node.connected).toBe(false)
  expect(console.error).toHaveBeenCalledWith(
    'Without SSL, old proxies block WebSockets. ' +
      'Use WSS for Logux or set allowDangerousProtocol option.'
  )
})

it('ignores WS with allowDangerousProtocol', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let client = await createDialog({
    allowDangerousProtocol: true,
    server: 'ws://test.com'
  })
  expect(client.node.connected).toBe(true)
  expect(console.error).not.toHaveBeenCalledWith()
})

it('ignores WS in development', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let client = await createDialog(
    {
      server: 'ws://test.com'
    },
    'development'
  )
  expect(client.node.connected).toBe(true)
  expect(console.error).not.toHaveBeenCalledWith()
})

it('uses user ID in node ID', () => {
  let client1 = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  expect(client1.clientId).toMatch(/^10:[\w-]{8}$/)
  expect(client1.tabId).toMatch(/^[\w-]{8}$/)
  expect(client1.nodeId).toEqual(client1.clientId + ':' + client1.tabId)

  let client2 = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  expect(client2.nodeId).toEqual(client2.clientId + ':' + client2.tabId)
})

it('uses node ID in ID generator', () => {
  let client = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10',
    time: new TestTime()
  })
  let id = client.log.generateId()
  expect(id).toContain('1 10:1:1 0')
})

it('uses custom store', () => {
  let store = new MemoryStore()
  let client = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10',
    store
  })
  expect(client.log.store).toBe(store)
})

it('sends options to connection', () => {
  let client = new Client({
    subprotocol: '1.0.0',
    minDelay: 100,
    maxDelay: 500,
    attempts: 5,
    server: 'wss://localhost:1337',
    userId: '10'
  })
  expect(privateMethods(client.node.connection).options).toEqual({
    minDelay: 100,
    maxDelay: 500,
    attempts: 5
  })
  expect(privateMethods(client.node.connection).connection.url).toEqual(
    'wss://localhost:1337'
  )
})

it('sends options to node', () => {
  let client = new Client({
    subprotocol: '1.0.0',
    timeout: 2000,
    server: 'wss://localhost:1337',
    userId: '10',
    token: 'token',
    ping: 1000
  })
  expect(client.node.options.subprotocol).toEqual('1.0.0')
  expect(client.node.options.token).toEqual('token')
  expect(client.node.options.timeout).toEqual(2000)
  expect(client.node.options.ping).toEqual(1000)
})

it('uses test time', () => {
  let client = createClient()
  expect(client.log.generateId()).toEqual('1 10:1:1 0')
})

it('connects', () => {
  let client = createClient()
  jest.spyOn(client.node.connection, 'connect')
  client.start()
  expect(client.node.connection.connect).toHaveBeenCalledTimes(1)
})

it('display server debug error stacktrace with prefix', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let client = createClient()
  emit(client.node, 'debug', 'error', 'Fake stacktrace\n')
  expect(console.error).toHaveBeenCalledWith(
    'Error on Logux server:\n',
    'Fake stacktrace\n'
  )
})

it('does not display server debug message if type is not error', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let client = createClient()
  emit(client.node, 'debug', 'notError', 'Fake stacktrace\n')
  expect(console.error).not.toHaveBeenCalled()
})

it('cleans everything', async () => {
  let client = createClient()
  jest.spyOn(client.node, 'destroy')
  jest.spyOn(client.log.store, 'clean')
  await client.clean()
  expect(client.node.destroy).toHaveBeenCalledTimes(1)
  expect(client.log.store.clean).toHaveBeenCalledTimes(1)
})

it('pings after tab-specific action', async () => {
  let client = createClient()
  let id = client.tabId
  client.options.prefix = 'test'
  client.node.connection.connect = () => Promise.resolve()

  client.start()
  expect(localStorage.getItem('test:tab:' + id)).toBeUndefined()

  let prev
  await client.log.add({ type: 'A' }, { reasons: ['tab' + id] })
  expect(localStorage.getItem('test:tab:' + id)).toBeDefined()
  prev = localStorage.getItem('test:tab:' + id)
  await delay(privateMethods(client).tabPing)
  expect(localStorage.getItem('test:tab:' + id)).toBeGreaterThan(toNumber(prev))
})

it('cleans own actions on destroy', async () => {
  let client = createClient()
  client.start()
  await client.log.add(
    { type: 'A' },
    { tab: client.tabId, reasons: ['tab' + client.tabId] }
  )
  client.destroy()
  await delay(1)
  expect(client.log.actions()).toHaveLength(0)
  expect(localStorage.getItem('test:tab:' + client.tabId)).toBeUndefined()
})

it('cleans own actions on unload', async () => {
  let client = createClient()
  client.start()
  await client.log.add(
    { type: 'A' },
    { tab: client.tabId, reasons: ['tab' + client.tabId] }
  )
  window.dispatchEvent(new Event('unload'))
  await delay(1)
  expect(client.log.actions()).toHaveLength(0)
  expect(localStorage.getItem('test:tab:' + client.tabId)).toBeUndefined()
})

it('cleans other tab action after timeout', async () => {
  let client = createClient()
  await Promise.all([
    client.log.add({ type: 'A' }, { tab: '1', reasons: ['tab1'] }),
    client.log.add({ type: 'B' }, { tab: '2', reasons: ['tab2'] })
  ])
  let tabTimeout: number = privateMethods(client).tabTimeout
  localStorage.setItem('logux:tab:1', `${Date.now() - tabTimeout - 1}`)
  localStorage.setItem('logux:tab:2', `${Date.now() - tabTimeout + 100}`)
  client.start()
  await delay(1)
  expect(client.log.actions()).toEqual([{ type: 'B' }])
  expect(localStorage.getItem('test:tab:2')).toBeUndefined()
})

it('adds current subprotocol to meta', async () => {
  let client = createClient()
  await client.log.add({ type: 'A' }, { reasons: ['test'] })
  expect(client.log.entries()[0][1].subprotocol).toEqual('1.0.0')
})

it('adds current subprotocol only to own actions', async () => {
  let client = createClient()
  await client.log.add(
    { type: 'A' },
    { reasons: ['test'], id: '1 0:client:other 0' }
  )
  expect(client.log.entries()[0][1].subprotocol).toBeUndefined()
})

it('allows to override subprotocol in meta', async () => {
  let client = createClient()
  await client.log.add(
    { type: 'A' },
    { subprotocol: '0.1.0', reasons: ['test'] }
  )
  expect(client.log.entries()[0][1].subprotocol).toEqual('0.1.0')
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
        id: '1 a:client:uuid 0',
        time: 1,
        sync: true,
        users: ['0'],
        nodes: ['0:client:uuid'],
        custom: 1,
        reasons: ['test'],
        clients: ['0:client'],
        channels: ['user:0']
      }
    ),
    client.log.add(
      { type: 'c' },
      {
        id: '1 0:client:uuid 0',
        sync: true,
        reasons: ['test']
      }
    )
  ])
  pair.right.send(['synced', 1])
  await client.node.waitFor('synchronized')
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
        sync: true,
        reasons: ['test'],
        subprotocol: '1.0.0'
      }
    ),
    client.log.add(
      { type: 'a' },
      {
        id: '2 10:client:id 0',
        sync: true,
        reasons: ['test'],
        subprotocol: '2.0.0'
      }
    )
  ])
  pair.right.send(['synced', 1])
  pair.right.send(['synced', 2])
  await client.node.waitFor('synchronized')
  expect(pair.leftSent).toEqual([
    ['sync', 1, { type: 'a' }, { id: [1, '10:client:id', 0], time: 1 }],
    [
      'sync',
      2,
      { type: 'a' },
      {
        id: [2, '10:client:id', 0],
        time: 2,
        subprotocol: '2.0.0'
      }
    ]
  ])
})

it('warns about subscription actions without sync', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let client = createClient()
  await Promise.all([
    client.log.add({ type: 'logux/subscribe', name: 'test' }),
    client.log.add({ type: 'logux/unsubscribe', name: 'test' })
  ])
  expect(console.error).toHaveBeenNthCalledWith(
    1,
    'logux/subscribe action without meta.sync'
  )
  expect(console.error).toHaveBeenNthCalledWith(
    2,
    'logux/unsubscribe action without meta.sync'
  )
})

it('keeps synced actions before synchronization', async () => {
  let client = createClient()
  await Promise.all([
    client.log.add({ type: 'A' }, { sync: true }),
    client.log.add({ type: 'B' }, { sync: true })
  ])
  expect(client.log.actions()).toEqual([{ type: 'A' }, { type: 'B' }])
  await Promise.all([
    client.log.add({ type: 'logux/processed', id: '1 10:1:1 0' }),
    client.log.add({ type: 'logux/undo', id: '2 10:1:1 0' })
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
  await Promise.all([
    client.log.add({ type: 'logux/subscribe', channel: 'a' }, { sync: true }),
    client.log.add({ type: 'logux/subscribe', channel: 'a' }, { sync: true }),
    client.log.add(
      { type: 'logux/subscribe', channel: 'b', b: 1 },
      { sync: true }
    ),
    client.log.add(
      { type: 'logux/subscribe', channel: 'b', b: 2 },
      { sync: true }
    ),
    client.log.add(
      { type: 'logux/subscribe', channel: 'b', b: 2 },
      { sync: true }
    ),
    client.log.add(
      { type: 'logux/unsubscribe', channel: 'b', b: 1 },
      { sync: true }
    ),
    client.log.add(
      { type: 'logux/unsubscribe', channel: 'b', b: 2 },
      { sync: true }
    )
  ])
  added = []
  expect(client.log.actions()).toHaveLength(7)
  setState(client, 'synchronized')
  expect(added).toHaveLength(0)

  client.log.add({ type: 'logux/processed', id: '1 10:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '2 10:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '3 10:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '4 10:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '5 10:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '6 10:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '7 10:1:1 0' })
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
      type: 'logux/subscribe',
      channel: 'a',
      since: { id: '9 10:1:1 0', time: 9 }
    },
    {
      type: 'logux/subscribe',
      channel: 'b',
      b: 2,
      since: { id: '12 10:1:1 0', time: 12 }
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
    { type: 'logux/subscribe', channel: 'a' },
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
    client.log.add({ type: 'logux/subscribe', channel: 'a' }, { sync: true }),
    client.log.add({ type: 'logux/subscribe', channel: 'b' }, { sync: true })
  ])
  added = []
  await Promise.all([
    client.log.add({ type: 'logux/processed', id: '1 10:1:1 0' }),
    client.log.add({ type: 'logux/processed', id: '2 10:1:1 0' }),
    client.log.add({ type: 'A' }, { channels: ['a'], id: '8 10:2:1 0' }),
    client.log.add({ type: 'B' }, { channels: ['b'], id: '0 10:2:1 0' }),
    client.log.add({ type: 'A' }, { channels: ['a'], id: '9 10:1:1 0' })
  ])
  setState(client, 'disconnected')
  setState(client, 'connecting')
  setState(client, 'synchronized')
  expect(added).toEqual([
    {
      type: 'logux/subscribe',
      channel: 'a',
      since: { time: 8, id: '8 10:2:1 0' }
    },
    {
      type: 'logux/subscribe',
      channel: 'b',
      since: { time: 4, id: '4 10:1:1 0' }
    }
  ])
})

it('changes user ID', async () => {
  let client = await createDialog()
  let pair = getPair(client)
  client.changeUser('20', 'token')
  expect(client.node.state).toEqual('connecting')
  pair.right.send(['connected', client.node.localProtocol, 'server', [0, 0]])
  await client.node.waitFor('synchronized')
})

it('changes user ID of disconnected node', async () => {
  let client = await createDialog()
  client.node.connection.disconnect()
  client.changeUser('20', 'token')
  expect(client.node.localNodeId).toEqual('20:1:1')
  expect(client.node.state).toEqual('disconnected')
  let meta = await client.log.add({ type: 'test' })
  if (meta === false) throw new Error('Action was not found')
  expect(meta.id).toContain(' 20:1:1 ')
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
