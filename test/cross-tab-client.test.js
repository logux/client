var CrossTabClient = require('../cross-tab-client')

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

function createClient () {
  return new CrossTabClient({
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
  var client = new CrossTabClient({
    subprotocol: '1.0.0',
    userId: false,
    url: 'wss://localhost:1337'
  })
  expect(client.options.subprotocol).toEqual('1.0.0')
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

it('cleans everything', function () {
  global.localStorage = {
    removeItem: jest.fn()
  }
  var client = createClient()
  client.sync.destroy = jest.fn()
  return client.clean().then(function () {
    expect(client.sync.destroy).toHaveBeenCalled()
    expect(global.localStorage.removeItem.mock.calls).toEqual([
      ['logux:false:add'], ['logux:false:clean'],
      ['logux:false:state'], ['logux:false:leader']
    ])
  })
})

it('synchronizes events between tabs', function () {
  global.localStorage = {
    setItem: function (name, value) {
      emitStorage(name, value)
    }
  }
  var client1 = new CrossTabClient({
    subprotocol: '1.0.0',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  var client2 = new CrossTabClient({
    subprotocol: '1.0.0',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  var client3 = new CrossTabClient({
    subprotocol: '1.0.0',
    prefix: 'other',
    userId: 10,
    url: 'wss://localhost:1337'
  })
  var client4 = new CrossTabClient({
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

it('uses candidate role from beggining', function () {
  var client = createClient()
  expect(client.role).toEqual('candidate')
})

it('becomes leader without localStorage', function () {
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
  expect(client1.roleTimeout).not.toEqual(client2.roleTimeout)
})

it('replaces dead leader', function () {
  global.localStorage = fakeLocalStorage
  localStorage.setItem('logux:false:leader', '["",' + (Date.now() - 4900) + ']')
  var client = createClient()
  client.roleTimeout = 200

  client.start()
  return wait(client.roleTimeout).then(function () {
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

it('has connected shortcut', function () {
  var client = createClient()
  expect(client.connected).toBeFalsy()
  client.state = 'wait'
  expect(client.connected).toBeFalsy()
  client.state = 'sending'
  expect(client.connected).toBeTruthy()
})
