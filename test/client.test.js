var fakeIndexedDB = require('fake-indexeddb')
var MemoryStore = require('logux-core').MemoryStore

var Client = require('../client')

var originWarn = console.warn
var originIndexedDB = global.indexedDB
afterEach(function () {
  console.warn = originWarn
  global.indexedDB = originIndexedDB
})

it('saves options', function () {
  var client = new Client({ subprotocol: '1.0.0', url: 'wss://localhost:1337' })
  expect(client.options.subprotocol).toEqual('1.0.0')
})

it('throws on missed URL', function () {
  expect(function () {
    new Client({ subprotocol: '1.0.0' })
  }).toThrowError(/url/)
})

it('throws on missed subprotocol', function () {
  expect(function () {
    new Client({ url: 'wss://localhost:1337' })
  }).toThrowError(/subprotocol/)
})

it('not warns on WSS', function () {
  console.warn = jest.fn()

  new Client({
    subprotocol: '1.0.0',
    url: 'wss://test.com'
  })

  expect(console.warn).not.toBeCalled()
})

it('forces to use WSS in production domain', function () {
  console.warn = jest.fn()

  new Client({
    subprotocol: '1.0.0',
    url: 'ws://test.com'
  })

  expect(console.warn).toBeCalledWith(
    'Without SSL, old proxies can block WebSockets. ' +
    'Use WSS connection for Logux or set allowDangerousProtocol option.'
  )
})

it('ignores WS with allowDangerousProtocol', function () {
  console.warn = jest.fn()

  new Client({
    allowDangerousProtocol: true,
    subprotocol: '1.0.0',
    url: 'ws://test.com'
  })

  expect(console.warn).not.toBeCalled()
})

it('ignores WS in development', function () {
  console.warn = jest.fn()

  new Client({
    subprotocol: '1.0.0',
    url: 'ws://localhost:1337'
  })

  expect(console.warn).not.toBeCalled()
})

it('generates node ID if it is missed', function () {
  var client = new Client({ subprotocol: '1.0.0', url: 'wss://localhost:1337' })
  expect(client.options.nodeId).toMatch(/[\d\w]+/)
})

it('uses custom node ID', function () {
  var client = new Client({
    subprotocol: '1.0.0',
    nodeId: 'client',
    url: 'wss://localhost:1337'
  })
  expect(client.options.nodeId).toEqual('client')
})

it('uses node ID in ID generator', function () {
  var client = new Client({ subprotocol: '1.0.0', url: 'wss://localhost:1337' })
  var id = client.log.generateId()
  expect(typeof id[0]).toEqual('number')
  expect(id[1]).toEqual(client.options.nodeId)
  expect(id[2]).toBe(0)
})

it('uses custom store', function () {
  var store = new MemoryStore()
  var client = new Client({
    subprotocol: '1.0.0',
    store: store,
    url: 'wss://localhost:1337'
  })
  expect(client.log.store).toBe(store)
})

it('uses custom prefix', function () {
  global.indexedDB = fakeIndexedDB
  var client = new Client({
    subprotocol: '1.0.0',
    prefix: 'app',
    url: 'wss://localhost:1337'
  })
  expect(client.log.store.name).toEqual('app')
})

it('sends options to connection', function () {
  var client = new Client({
    subprotocol: '1.0.0',
    minDelay: 100,
    maxDelay: 500,
    attempts: 5,
    url: 'wss://localhost:1337'
  })
  expect(client.sync.connection.options).toEqual({
    minDelay: 100,
    maxDelay: 500,
    attempts: 5
  })
  expect(client.sync.connection.connection.url).toEqual('wss://localhost:1337')
})

it('sends options to sync', function () {
  var client = new Client({
    subprotocol: '1.0.0',
    credentials: 'token',
    timeout: 2000,
    ping: 1000,
    url: 'wss://localhost:1337'
  })
  expect(client.sync.options.subprotocol).toEqual('1.0.0')
  expect(client.sync.options.credentials).toEqual('token')
  expect(client.sync.options.timeout).toEqual(2000)
  expect(client.sync.options.ping).toEqual(1000)
})
