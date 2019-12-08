let { MemoryStore, TestPair, TestTime } = require('@logux/core')
let delay = require('nanodelay')

let Client = require('../client')

beforeEach(() => {
  Object.defineProperty(global, '_localStorage', {
    value: {
      storage: { },
      setItem (key, value) {
        this[key] = value
        this.storage[key] = value
      },
      getItem (key) {
        return this.storage[key]
      },
      removeItem (key) {
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

async function createDialog (opts, credentials) {
  let pair = new TestPair()

  if (!opts) opts = { }
  if (!opts.subprotocol) opts.subprotocol = '1.0.0'
  if (!opts.userId) opts.userId = 10
  if (!opts.server) opts.server = pair.left
  if (!opts.time) opts.time = new TestTime()

  let client = new Client(opts)

  if (typeof opts.server === 'string') {
    let events1 = client.node.connection.connection.emitter.events
    let events2 = pair.left.emitter.events
    for (let i in events1) {
      if (events2[i]) {
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
  pair.right.send(
    ['connected', client.node.localProtocol, 'server', [0, 0], { credentials }]
  )
  await pair.wait('left')
  await Promise.resolve()
  if (client.node.connected) {
    await client.node.waitFor('synchronized')
  }
  client.node.timeFix = 0
  return client
}

function createClient () {
  let client = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: false,
    time: new TestTime()
  })
  client.node.connection.connect = () => true
  client.tabPing = 50
  return client
}

it('saves options', () => {
  let client = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: false
  })
  expect(client.options.subprotocol).toEqual('1.0.0')
})

it('throws on missed server', () => {
  expect(() => {
    new Client({ userId: false, subprotocol: '1.0.0' })
  }).toThrow(/server/)
})

it('throws on missed subprotocol', () => {
  expect(() => {
    new Client({ userId: false, server: 'wss://localhost:1337' })
  }).toThrow(/subprotocol/)
})

it('throws on missed user ID', () => {
  expect(() => {
    new Client({ subprotocol: '1.0.0', server: 'wss://localhost:1337' })
  }).toThrow(/userId/)
})

it('not warns on WSS', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => { })
  let client = await createDialog()
  expect(client.node.connected).toBe(true)
  expect(console.error).not.toHaveBeenCalledWith()
})

it('forces to use WSS in production domain', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => { })
  let client = await createDialog({ server: 'ws://test.com' })
  expect(client.node.connected).toBe(false)
  expect(console.error).toHaveBeenCalledWith(
    'Without SSL, old proxies block WebSockets. ' +
    'Use WSS for Logux or set allowDangerousProtocol option.'
  )
})

it('ignores WS with allowDangerousProtocol', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => { })
  let client = await createDialog({
    allowDangerousProtocol: true,
    server: 'ws://test.com'
  })
  expect(client.node.connected).toBe(true)
  expect(console.error).not.toHaveBeenCalledWith()
})

it('ignores WS in development', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => { })
  let client = await createDialog({
    server: 'ws://test.com'
  }, {
    env: 'development'
  })
  expect(client.node.connected).toBe(true)
  expect(console.error).not.toHaveBeenCalledWith()
})

it('uses user ID in node ID', () => {
  let client1 = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: 10
  })
  expect(client1.clientId).toMatch(/^10:[\w-]{8}$/)
  expect(client1.tabId).toMatch(/^[\w-]{8}$/)
  expect(client1.nodeId).toEqual(client1.clientId + ':' + client1.tabId)

  let client2 = new Client({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: false
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
    userId: false,
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
    userId: false
  })
  expect(client.node.connection.options).toEqual({
    minDelay: 100,
    maxDelay: 500,
    attempts: 5
  })
  expect(client.node.connection.connection.url).toEqual('wss://localhost:1337')
})

it('sends options to node', () => {
  let client = new Client({
    subprotocol: '1.0.0',
    credentials: 'token',
    timeout: 2000,
    server: 'wss://localhost:1337',
    userId: false,
    ping: 1000
  })
  expect(client.node.options.subprotocol).toEqual('1.0.0')
  expect(client.node.options.credentials).toEqual('token')
  expect(client.node.options.timeout).toEqual(2000)
  expect(client.node.options.ping).toEqual(1000)
})

it('uses test time', () => {
  let client = createClient()
  expect(client.log.generateId()).toEqual('1 false:1:1 0')
})

it('connects', () => {
  let client = createClient()
  jest.spyOn(client.node.connection, 'connect')
  client.start()
  expect(client.node.connection.connect).toHaveBeenCalledTimes(1)
})

it('display server debug error stacktrace with prefix', () => {
  jest.spyOn(console, 'error').mockImplementation(() => { })
  let client = createClient()
  client.node.emitter.emit('debug', 'error', 'Fake stacktrace\n')
  expect(console.error).toHaveBeenCalledWith(
    'Error on Logux server:\n',
    'Fake stacktrace\n'
  )
})

it('does not display server debug message if type is not error', () => {
  jest.spyOn(console, 'error').mockImplementation(() => { })
  let client = createClient()
  client.node.emitter.emit('debug', 'notError', 'Fake stacktrace\n')
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
  client.node.connection.connect = () => true

  client.start()
  expect(localStorage.getItem('test:tab:' + id)).toBeUndefined()

  let prev
  await client.log.add({ type: 'A' }, { reasons: ['tab' + id] })
  expect(localStorage.getItem('test:tab:' + id)).toBeDefined()
  prev = localStorage.getItem('test:tab:' + id)
  await delay(client.tabPing)
  expect(localStorage.getItem('test:tab:' + id)).toBeGreaterThan(prev)
})

it('cleans own actions on destroy', async () => {
  let client = createClient()
  client.start()
  await client.log.add(
    { type: 'A' }, { tab: client.tabId, reasons: ['tab' + client.tabId] }
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
    { type: 'A' }, { tab: client.tabId, reasons: ['tab' + client.tabId] }
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
  localStorage.setItem('logux:tab:1', Date.now() - client.tabTimeout - 1)
  localStorage.setItem('logux:tab:2', Date.now() - client.tabTimeout + 100)
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
  client.node.connection.pair.clear()
  await Promise.all([
    client.log.add({ type: 'a' }, { id: '1 10:client:uuid 0', sync: true }),
    client.log.add({ type: 'c' }, { id: '2 10:client:uuid 0' })
  ])
  client.node.connection.pair.right.send(['synced', 1])
  await client.node.waitFor('synchronized')
  expect(client.node.connection.pair.leftSent).toEqual([
    ['sync', 1, { type: 'a' }, { id: [1, '10:client:uuid', 0], time: 1 }]
  ])
})

it('filters data before sending', async () => {
  let client = await createDialog({ userId: 'a' })
  client.node.connection.pair.clear()
  await Promise.all([
    client.log.add({ type: 'a' }, {
      id: '1 a:client:uuid 0',
      time: 1,
      sync: true,
      users: ['0'],
      nodes: ['0:client:uuid'],
      custom: 1,
      reasons: ['test'],
      clients: ['0:client'],
      channels: ['user:0']
    }),
    client.log.add({ type: 'c' }, {
      id: '1 0:client:uuid 0',
      sync: true,
      reasons: ['test']
    })
  ])
  client.node.connection.pair.right.send(['synced', 1])
  await client.node.waitFor('synchronized')
  expect(client.node.connection.pair.leftSent).toEqual([
    [
      'sync',
      1,
      { type: 'a' },
      { id: [1, 'a:client:uuid', 0], time: 1, channels: ['user:0'] }
    ]
  ])
})

it('compresses subprotocol', async () => {
  let client = await createDialog()
  client.node.connection.pair.clear()
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
  client.node.connection.pair.right.send(['synced', 1])
  client.node.connection.pair.right.send(['synced', 2])
  await client.node.waitFor('synchronized')
  expect(client.node.connection.pair.leftSent).toEqual([
    ['sync', 1, { type: 'a' }, { id: [1, '10:client:id', 0], time: 1 }],
    ['sync', 2, { type: 'a' }, {
      id: [2, '10:client:id', 0], time: 2, subprotocol: '2.0.0'
    }]
  ])
})

it('warns about subscription actions without sync', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => { })
  let client = createClient()
  await Promise.all([
    client.log.add({ type: 'logux/subscribe', name: 'test' }),
    client.log.add({ type: 'logux/unsubscribe', name: 'test' })
  ])
  expect(console.error.mock.calls).toEqual([
    ['logux/subscribe action without meta.sync'],
    ['logux/unsubscribe action without meta.sync']
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
    client.log.add({ type: 'logux/processed', id: '1 false:1:1 0' }),
    client.log.add({ type: 'logux/undo', id: '2 false:1:1 0' })
  ])
  expect(client.log.actions()).toHaveLength(0)
})

it('resubscribes to previous subscriptions', async () => {
  let client = createClient()
  let added = []
  client.on('preadd', action => {
    if (action.type === 'logux/subscribe') {
      added.push(action)
    }
  })
  await Promise.all([
    client.log.add(
      { type: 'logux/subscribe', channel: 'a' }, { sync: true }),
    client.log.add(
      { type: 'logux/subscribe', channel: 'a' }, { sync: true }),
    client.log.add(
      { type: 'logux/subscribe', channel: 'b', b: 1 }, { sync: true }),
    client.log.add(
      { type: 'logux/subscribe', channel: 'b', b: 2 }, { sync: true }),
    client.log.add(
      { type: 'logux/subscribe', channel: 'b', b: 2 }, { sync: true }),
    client.log.add(
      { type: 'logux/unsubscribe', channel: 'b', b: 1 }, { sync: true }),
    client.log.add(
      { type: 'logux/unsubscribe', channel: 'b', b: 2 }, { sync: true })
  ])
  added = []
  expect(client.log.actions()).toHaveLength(7)
  client.node.setState('synchronized')
  expect(added).toHaveLength(0)

  client.log.add({ type: 'logux/processed', id: '1 false:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '2 false:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '3 false:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '4 false:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '5 false:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '6 false:1:1 0' })
  client.log.add({ type: 'logux/processed', id: '7 false:1:1 0' })
  await delay(1)
  expect(client.log.actions()).toHaveLength(0)

  client.node.setState('sending')
  client.node.setState('synchronized')
  expect(added).toHaveLength(0)

  client.node.setState('disconnected')
  client.node.setState('connecting')
  client.node.setState('synchronized')
  expect(added).toEqual([
    {
      type: 'logux/subscribe',
      channel: 'a',
      since: { id: '9 false:1:1 0', time: 9 }
    },
    {
      type: 'logux/subscribe',
      channel: 'b',
      b: 2,
      since: { id: '12 false:1:1 0', time: 12 }
    }
  ])

  expect(client.log.actions()).toHaveLength(0)
})

it('does not subscribing twice during connection', async () => {
  let client = createClient()
  let added = []
  client.on('preadd', action => {
    if (action.type === 'logux/subscribe') {
      added.push(action)
    }
  })
  client.node.setState('connecting')
  client.node.setState('sending')
  await client.log.add(
    { type: 'logux/subscribe', channel: 'a' }, { sync: true }
  )
  added = []
  client.node.setState('synchronized')
  expect(added).toEqual([])
})

it('tells last action time during resubscription', async () => {
  let client = createClient()
  let added = []
  client.on('preadd', action => {
    if (action.type === 'logux/subscribe') {
      added.push(action)
    }
  })
  client.node.setState('synchronized')
  await Promise.all([
    client.log.add({ type: 'logux/subscribe', channel: 'a' }, { sync: true }),
    client.log.add({ type: 'logux/subscribe', channel: 'b' }, { sync: true })
  ])
  added = []
  await Promise.all([
    client.log.add({ type: 'logux/processed', id: '1 false:1:1 0' }),
    client.log.add({ type: 'logux/processed', id: '2 false:1:1 0' }),
    client.log.add({ type: 'A' }, { channels: ['a'], id: '8 false:2:1 0' }),
    client.log.add({ type: 'B' }, { channels: ['b'], id: '0 false:2:1 0' }),
    client.log.add({ type: 'A' }, { channels: ['a'], id: '9 false:1:1 0' })
  ])
  client.node.setState('disconnected')
  client.node.setState('connecting')
  client.node.setState('synchronized')
  expect(added).toEqual([
    {
      type: 'logux/subscribe',
      channel: 'a',
      since: { time: 8, id: '8 false:2:1 0' }
    },
    {
      type: 'logux/subscribe',
      channel: 'b',
      since: { time: 4, id: '4 false:1:1 0' }
    }
  ])
})
