var createTestTimer = require('logux-core').createTestTimer
var MemoryStore = require('logux-core').MemoryStore
require('mock-local-storage')

var Client = require('../client')

var originStorage = localStorage
afterEach(function () {
  global.localStorage = originStorage
  localStorage.clear()
  localStorage.itemInsertionCallback = null
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

it('uses node ID in timer', function () {
  var client = new Client({ subprotocol: '1.0.0', url: 'wss://localhost:1337' })
  var time = client.log.timer()
  expect(typeof time[0]).toEqual('number')
  expect(time[1]).toEqual(client.options.nodeId)
  expect(time[2]).toBe(0)
})

it('uses custom timer', function () {
  var client = new Client({
    subprotocol: '1.0.0',
    timer: createTestTimer(),
    url: 'wss://localhost:1337'
  })
  expect(client.log.timer()).toEqual([1])
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

it('uses default synced', function () {
  var client = new Client({ subprotocol: '1.0.0', url: 'wss://localhost:1337' })
  expect(client.sync.synced).toBe(0)
  expect(client.sync.otherSynced).toBe(0)
})

it('stores synced from LocalStorage', function () {
  localStorage.setItem('loguxSynced', 100)
  localStorage.setItem('loguxOtherSynced', 200)

  var client = new Client({ subprotocol: '1.0.0', url: 'wss://localhost:1337' })
  expect(client.log.store.key).toEqual('loguxLog')
  expect(client.sync.synced).toBe(100)
  expect(client.sync.otherSynced).toBe(200)

  client.sync.setSynced(101)
  expect(localStorage.getItem('loguxSynced')).toEqual('101')

  client.sync.setOtherSynced(201)
  expect(localStorage.getItem('loguxOtherSynced')).toEqual('201')
})

it('uses custom prefix', function () {
  localStorage.setItem('appSynced', 1)
  localStorage.setItem('appOtherSynced', 2)
  var client = new Client({
    subprotocol: '1.0.0',
    prefix: 'app',
    url: 'wss://localhost:1337'
  })

  expect(client.log.store.key).toEqual('appLog')
  expect(client.sync.synced).toBe(1)
  expect(client.sync.otherSynced).toBe(2)
})

it('works without localStorage', function () {
  global.localStorage = undefined
  var client = new Client({
    subprotocol: '1.0.0',
    store: new MemoryStore(),
    url: 'wss://localhost:1337'
  })
  expect(client.sync.synced).toBe(0)
})

it('works on localStorage limit error', function () {
  localStorage.itemInsertionCallback = function () {
    var err = new Error('Mock localStorage quota exceeded')
    err.code = DOMException.QUOTA_EXCEEDED_ERR
    throw err
  }

  var client = new Client({
    subprotocol: '1.0.0',
    store: new MemoryStore(),
    url: 'wss://localhost:1337'
  })
  client.sync.setSynced(1)
})

it('throws other errors from localStorage', function () {
  localStorage.itemInsertionCallback = function () {
    throw new Error('Test')
  }
  var client = new Client({
    subprotocol: '1.0.0',
    store: new MemoryStore(),
    url: 'wss://localhost:1337'
  })

  expect(function () {
    client.sync.setSynced(1)
  }).toThrowError('Test')
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
