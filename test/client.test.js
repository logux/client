var fakeIndexedDB = require('fake-indexeddb')
var MemoryStore = require('logux-core').MemoryStore
var ClientSync = require('logux-sync').ClientSync
var TestPair = require('logux-sync').TestPair

var Client = require('../client')

var fakeLocalStorage = {
  storage: { },
  setItem: function (key, value) {
    this.storage[key] = value
  },
  getItem: function (key) {
    return this.storage[key]
  },
  removeItem: function (key) {
    delete this.storage[key]
  }
}

var originError = console.error
var originIndexedDB = global.indexedDB
var originLocalStorage = global.localStorage
afterEach(function () {
  console.error = originError
  global.indexedDB = originIndexedDB
  global.localStorage = originLocalStorage
  fakeLocalStorage.storage = { }
})

function createDialog (opts, credentials) {
  var client = new Client(opts)

  var pair = new TestPair()
  client.sync = new ClientSync(
    client.options.nodeId,
    client.log,
    pair.left,
    client.sync.options
  )

  return client.sync.connection.connect().then(function () {
    return pair.wait('right')
  }).then(function () {
    pair.right.send(['connected', client.sync.localProtocol, 'server', [0, 0], {
      credentials: credentials
    }])
    return pair.wait('left')
  }).then(function () {
    return client
  })
}

function createClient () {
  return new Client({
    subprotocol: '1.0.0',
    userId: false,
    url: 'wss://localhost:1337'
  })
}

function emitStorage (name, value) {
  var event = new Event('storage')
  event.key = name
  event.newValue = value
  window.dispatchEvent(event)
}

function wait (ms) {
  return new Promise(function (resolve) {
    return setTimeout(resolve, ms)
  })
}

it('saves options', function () {
  var client = new Client({
    subprotocol: '1.0.0',
    userId: false,
    url: 'wss://localhost:1337'
  })
  expect(client.options.subprotocol).toEqual('1.0.0')
})

it('throws on missed URL', function () {
  expect(function () {
    new Client({ userId: false, subprotocol: '1.0.0' })
  }).toThrowError(/url/)
})

it('throws on missed subprotocol', function () {
  expect(function () {
    new Client({ userId: false, url: 'wss://localhost:1337' })
  }).toThrowError(/subprotocol/)
})

it('throws on missed user ID', function () {
  expect(function () {
    new Client({ subprotocol: '1.0.0', url: 'wss://localhost:1337' })
  }).toThrowError(/userId/)
})

it('not warns on WSS', function () {
  console.error = jest.fn()
  return createDialog({
    subprotocol: '1.0.0',
    userId: false,
    url: 'wss://test.com'
  }).then(function (client) {
    expect(client.sync.connected).toBeTruthy()
    expect(console.error).not.toBeCalledWith()
  })
})

it('forces to use WSS in production domain', function () {
  console.error = jest.fn()
  return createDialog({
    subprotocol: '1.0.0',
    userId: false,
    url: 'ws://test.com'
  }).then(function (client) {
    expect(client.sync.connected).toBeFalsy()
    expect(console.error).toBeCalledWith(
      'Without SSL, old proxies can block WebSockets. ' +
      'Use WSS connection for Logux or set allowDangerousProtocol option.'
    )
  })
})

it('ignores WS with allowDangerousProtocol', function () {
  console.error = jest.fn()
  return createDialog({
    allowDangerousProtocol: true,
    subprotocol: '1.0.0',
    userId: false,
    url: 'ws://test.com'
  }).then(function (client) {
    expect(client.sync.connected).toBeTruthy()
    expect(console.error).not.toBeCalledWith()
  })
})

it('ignores WS in development', function () {
  console.error = jest.fn()
  return createDialog({
    subprotocol: '1.0.0',
    userId: false,
    url: 'ws://test.com'
  }, {
    env: 'development'
  }).then(function (client) {
    expect(client.sync.connected).toBeTruthy()
    expect(console.error).not.toBeCalledWith()
  })
})

it('uses user ID in node ID', function () {
  var client1 = new Client({
    subprotocol: '1.0.0',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  expect(client1.id).toBeDefined()
  expect(client1.options.nodeId).toEqual('10:' + client1.id)

  var client2 = new Client({
    subprotocol: '1.0.0',
    userId: false,
    url: 'wss://localhost:1337'
  })
  expect(client2.options.nodeId).not.toMatch(/:/)
})

it('uses node ID in ID generator', function () {
  var client = createClient()
  var id = client.log.generateId()
  expect(typeof id[0]).toEqual('number')
  expect(id[1]).toEqual(client.options.nodeId)
  expect(id[2]).toBe(0)
})

it('uses custom store', function () {
  var store = new MemoryStore()
  var client = new Client({
    subprotocol: '1.0.0',
    userId: false,
    store: store,
    url: 'wss://localhost:1337'
  })
  expect(client.log.store).toBe(store)
})

it('uses user ID in store name', function () {
  global.indexedDB = fakeIndexedDB
  var client = new Client({
    subprotocol: '1.0.0',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  expect(client.log.store.name).toEqual('logux:10')
})

it('uses custom prefix', function () {
  global.indexedDB = fakeIndexedDB
  var client = new Client({
    subprotocol: '1.0.0',
    prefix: 'app',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  expect(client.log.store.name).toEqual('app:10')
})

it('sends options to connection', function () {
  var client = new Client({
    subprotocol: '1.0.0',
    minDelay: 100,
    maxDelay: 500,
    attempts: 5,
    userId: false,
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
    userId: false,
    ping: 1000,
    url: 'wss://localhost:1337'
  })
  expect(client.sync.options.subprotocol).toEqual('1.0.0')
  expect(client.sync.options.credentials).toEqual('token')
  expect(client.sync.options.timeout).toEqual(2000)
  expect(client.sync.options.ping).toEqual(1000)
})

it('display server debug error stacktrace with prefix', function () {
  console.error = jest.fn()
  var client = createClient()
  client.sync.emitter.emit('debug', 'error', 'Fake stacktrace\n')
  expect(console.error).toHaveBeenCalledWith(
      'Error on Logux server:\n',
      'Fake stacktrace\n'
  )
})

it('does not display server debug message if type is not error', function () {
  console.error = jest.fn()
  var client = createClient()
  client.sync.emitter.emit('debug', 'notError', 'Fake stacktrace\n')
  expect(console.error).not.toHaveBeenCalled()
})

it('cleans everything', function () {
  global.indexedDB = fakeIndexedDB
  global.localStorage = {
    removeItem: jest.fn()
  }
  var client = createClient()
  client.sync.destroy = jest.fn()
  client.log.store.clean = jest.fn(client.log.store.clean)
  return client.clean().then(function () {
    expect(client.sync.destroy).toHaveBeenCalled()
    expect(client.log.store.clean).toHaveBeenCalled()
    expect(global.localStorage.removeItem.mock.calls).toEqual([
      ['logux:false:add'], ['logux:false:clean'],
      ['logux:false:state'], ['logux:false:leader']
    ])
  })
})

it('clean memory store', function () {
  var client = createClient()
  return client.clean().then(function () {
    expect(client.log).not.toBeDefined()
  })
})

it('synchronizes events between tabs', function () {
  global.localStorage = {
    setItem: function (name, value) {
      emitStorage(name, value)
    }
  }
  var client1 = new Client({
    subprotocol: '1.0.0',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  var client2 = new Client({
    subprotocol: '1.0.0',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  var client3 = new Client({
    subprotocol: '1.0.0',
    prefix: 'other',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  var client4 = new Client({
    subprotocol: '1.0.0',
    userId: 20,
    url: 'wss://localhost:1337'
  })

  var events = []
  client1.on('add', function (action, meta) {
    events.push(['add', action, meta.reasons])
  })
  client1.on('clean', function (action, meta) {
    events.push(['clean', action, meta.reasons])
  })

  return client2.log.add({ type: 'A' }).then(function () {
    return client3.log.add({ type: 'B' })
  }).then(function () {
    return client2.log.add({ type: 'C' }, { tab: client1.id })
  }).then(function () {
    return client2.log.add({ type: 'D' }, { tab: client2.id })
  }).then(function () {
    return client4.log.add({ type: 'E' })
  }).then(function () {
    expect(events).toEqual([
      ['add', { type: 'A' }, []],
      ['clean', { type: 'A' }, []],
      ['add', { type: 'C' }, []],
      ['clean', { type: 'C' }, []]
    ])
  })
})

it('supports nanoevents API', function () {
  var client = createClient()

  var once = []
  client.once('add', function (action) {
    once.push(action.type)
  })
  var twice = []
  var unbind = client.on('add', function (action) {
    twice.push(action.type)
    if (action.type === 'B') unbind()
  })

  return client.log.add({ type: 'A' }).then(function () {
    return client.log.add({ type: 'B' })
  }).then(function () {
    return client.log.add({ type: 'C' })
  }).then(function () {
    expect(once).toEqual(['A'])
    expect(twice).toEqual(['A', 'B'])
  })
})

it('uses candidate role from beggining', function () {
  var client = createClient()
  expect(client.role).toEqual('candidate')
})

it('becomes leader without localstorage', function () {
  var client = createClient()

  var roles = []
  client.on('role', function () {
    roles.push(client.role)
  })
  client.sync.connection.connect = jest.fn()

  client.start()
  expect(roles).toEqual(['leader'])
  expect(client.sync.connection.connect).toHaveBeenCalled()
})

it('becomes follower on recent leader ping', function () {
  global.localStorage = fakeLocalStorage
  localStorage.setItem('logux:false:leader', '["",' + Date.now() + ']')
  var client = createClient()

  var roles = []
  client.on('role', function () {
    roles.push(client.role)
  })
  client.sync.connection.connect = jest.fn()

  client.start()
  expect(roles).toEqual(['follower'])
  expect(client.sync.connection.connect).not.toHaveBeenCalled()
  expect(client.watching).toBeDefined()
})

it('stops election on second candidate', function () {
  global.localStorage = fakeLocalStorage
  var client = createClient()

  client.start()
  expect(client.role).toEqual('candidate')

  emitStorage('logux:false:leader', '["",' + Date.now() + ']')
  expect(client.role).toEqual('follower')
  expect(client.watching).toBeDefined()
})

it('stops election in leader check', function () {
  global.localStorage = fakeLocalStorage
  var client = createClient()

  client.start()
  expect(client.role).toEqual('candidate')

  localStorage.setItem('logux:false:leader', '["",' + Date.now() + ']')
  return wait(1010).then(function () {
    expect(client.role).toEqual('follower')
    expect(client.watching).toBeDefined()
  })
})

it('pings on leader role', function () {
  global.localStorage = fakeLocalStorage
  localStorage.setItem('logux:false:leader', '["",' + (Date.now() - 6000) + ']')
  var client = createClient()

  client.sync.connection.disconnect = jest.fn()

  client.start()
  expect(client.role).toEqual('candidate')
  return wait(1010).then(function () {
    expect(client.role).toEqual('leader')
    expect(client.watching).not.toBeDefined()
    return wait(2010)
  }).then(function () {
    var data = JSON.parse(localStorage.getItem('logux:false:leader'))
    expect(data[0]).toEqual(client.id)
    expect(Date.now() - data[1]).toBeLessThan(100)

    emitStorage('logux:false:leader', '["",' + Date.now() + ']')
    expect(client.role).toEqual('follower')
    expect(client.watching).toBeDefined()
  })
})

it('has random timeout', function () {
  var client1 = createClient()
  var client2 = createClient()
  expect(client1.timeout).not.toEqual(client2.timeout)
})

it('replaces dead leader', function () {
  global.localStorage = fakeLocalStorage
  localStorage.setItem('logux:false:leader', '["",' + (Date.now() - 4900) + ']')
  var client = createClient()
  client.timeout = 200

  client.start()
  return wait(client.timeout).then(function () {
    expect(client.role).toEqual('candidate')
  })
})

it('updates state if tab is a leader', function () {
  global.localStorage = fakeLocalStorage
  var client = createClient()
  client.start()
  expect(client.state).toEqual('disconnected')

  return wait(1050).then(function () {
    client.sync.state = 'synchronized'
    client.sync.emitter.emit('state')
    expect(client.state).toEqual('synchronized')
    expect(localStorage.getItem('logux:false:state')).toEqual('"synchronized"')
  })
})

it('listens for leader state', function () {
  global.localStorage = fakeLocalStorage
  localStorage.setItem('logux:false:leader', '["",' + Date.now() + ']')
  localStorage.setItem('logux:false:state', '"wait"')

  var client = createClient()
  var states = []
  client.on('state', function () {
    states.push(client.state)
  })
  client.start()
  expect(states).toEqual(['wait'])

  localStorage.removeItem('logux:false:state')
  emitStorage('logux:false:state', null)
  expect(states).toEqual(['wait'])

  localStorage.setItem('logux:false:state', '"synchronized"')
  emitStorage('logux:false:state', null)
  emitStorage('logux:false:state', '"sending"')
  emitStorage('logux:false:state', '"synchronized"')
  expect(states).toEqual(['wait', 'synchronized'])
})
