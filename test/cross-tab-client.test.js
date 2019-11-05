let { TestPair, TestTime } = require('@logux/core')
let delay = require('nanodelay')

let CrossTabClient = require('../cross-tab-client')

beforeEach(() => {
  class WebSocket {
    close () { }
  }
  global.WebSocket = WebSocket
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

let client
let originWindow = global.window
let originNavigator = global.navigator
let originWebSocket = global.WebSocket
let originIndexedDB = global.indexedDB
afterEach(() => {
  if (client) {
    client.destroy()
    client = undefined
  }
  global.window = originWindow
  global.navigator = originNavigator
  global.WebSocket = originWebSocket
  global.indexedDB = originIndexedDB
})

function createClient (overrides) {
  if (!overrides) overrides = { }
  let opts = {
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: false,
    time: new TestTime()
  }
  for (let i in overrides) {
    opts[i] = overrides[i]
  }
  let result = new CrossTabClient(opts)
  result.electionDelay = result.electionDelay / 20
  result.leaderTimeout = result.leaderTimeout / 20
  result.leaderPing = result.leaderPing / 20
  return result
}

function emitStorage (name, value) {
  let event = new Event('storage')
  event.key = name
  event.newValue = value
  window.dispatchEvent(event)
}

it('saves options', () => {
  client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: false
  })
  expect(client.options.subprotocol).toEqual('1.0.0')
})

it('saves client ID', () => {
  client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: false
  })
  let another = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: false
  })
  expect(client.clientId).toEqual(another.clientId)
})

it('supports nanoevents API', async () => {
  client = createClient()

  let twice = []
  let preadd = []
  client.on('preadd', action => {
    preadd.push(action.type)
  })
  let unbind = client.on('add', action => {
    twice.push(action.type)
    if (action.type === 'B') unbind()
  })

  await client.log.add({ type: 'A' })
  await client.log.add({ type: 'B' })
  await client.log.add({ type: 'C' })
  expect(preadd).toEqual(['A', 'B', 'C'])
  expect(twice).toEqual(['A', 'B'])
})

it('cleans everything', async () => {
  client = createClient()

  jest.spyOn(client.node, 'destroy')
  jest.spyOn(localStorage, 'removeItem')

  await client.clean()
  expect(client.node.destroy).toHaveBeenCalledTimes(1)
  expect(localStorage.removeItem.mock.calls).toEqual([
    ['logux:false:add'], ['logux:false:clean'],
    ['logux:false:state'], ['logux:false:client'], ['logux:false:leader']
  ])
})

it('does not use broken localStorage', async () => {
  localStorage.setItem = () => {
    throw new Error('The quota has been exceeded')
  }
  client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: 10
  })
  await client.log.add({ type: 'A' }, { reasons: ['tab' + client.tabId] })
})

it('synchronizes actions between tabs', async () => {
  localStorage.setItem = (name, value) => {
    emitStorage(name, value)
  }
  let client1 = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: 10
  })
  let client2 = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: 10
  })
  let client3 = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    prefix: 'other',
    userId: 10
  })
  let client4 = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: 20
  })

  let events = []
  client1.on('add', (action, meta) => {
    events.push(['add', action, meta.reasons])
  })
  client1.on('clean', (action, meta) => {
    events.push(['clean', action, meta.reasons])
  })

  await client2.log.add({ type: 'A' })
  await client3.log.add({ type: 'B' })
  await client2.log.add({ type: 'C' }, { tab: client1.tabId })
  await client2.log.add({ type: 'D' }, { tab: client2.tabId })
  await client4.log.add({ type: 'E' })
  expect(events).toEqual([
    ['add', { type: 'A' }, []],
    ['clean', { type: 'A' }, []],
    ['add', { type: 'C' }, []],
    ['clean', { type: 'C' }, []]
  ])
})

it('synchronizes actions from follower tabs', async () => {
  let pair = new TestPair()
  client = createClient({ server: pair.left })
  client.start()
  await pair.wait('left')
  pair.right.send(['connected', client.node.localProtocol, 'server', [0, 0]])
  await client.node.waitFor('synchronized')
  await delay(1)
  pair.clear()
  client.node.timeFix = 0
  let action = JSON.stringify({ type: 'A' })
  let meta = JSON.stringify({
    added: 1,
    time: 1,
    sync: true,
    id: '1 false:other 0'
  })
  emitStorage('logux:false:add', `["other",${ action },${ meta }]`)
  await delay(50)
  expect(pair.leftSent).toEqual([
    ['sync', 1, { type: 'A' }, { id: [1, 'false:other', 0], time: 1 }]
  ])
})

it('uses candidate role from beggining', () => {
  client = createClient()
  expect(client.role).toEqual('candidate')
})

it('becomes leader without localStorage', () => {
  Object.defineProperty(global, '_localStorage', { value: undefined })
  client = createClient()

  let roles = []
  client.on('role', () => {
    roles.push(client.role)
  })
  jest.spyOn(client.node.connection, 'connect')

  client.start()
  expect(roles).toEqual(['leader'])
  expect(client.node.connection.connect).toHaveBeenCalledTimes(1)
})

it('becomes leader without window', () => {
  delete global.window
  delete global.navigator
  Object.defineProperty(global, '_localStorage', { value: undefined })

  client = createClient()
  client.start()

  expect(client.role).toEqual('leader')
  client.destroy()
})

it('becomes follower on recent leader ping', () => {
  localStorage.setItem('logux:false:leader', `["",${ Date.now() }]`)
  client = createClient()

  let roles = []
  client.on('role', () => {
    roles.push(client.role)
  })
  jest.spyOn(client.node.connection, 'connect')

  client.start()
  expect(roles).toEqual(['follower'])
  expect(client.node.connection.connect).not.toHaveBeenCalled()
  expect(client.watching).toBeDefined()
})

it('stops election on second candidate', async () => {
  client = createClient()

  client.start()
  expect(client.role).toEqual('candidate')

  localStorage.setItem('logux:false:leader', `["",${ Date.now() - 10 }]`)
  await delay(client.electionDelay + 10)
  expect(client.role).toEqual('follower')
  expect(client.watching).toBeDefined()
})

it('stops election in leader check', async () => {
  client = createClient()

  client.start()
  expect(client.role).toEqual('candidate')

  localStorage.setItem('logux:false:leader', `["",${ Date.now() }]`)
  await delay(client.electionDelay + 10)
  expect(client.role).toEqual('follower')
  expect(client.watching).toBeDefined()
})

it('pings on leader role', async () => {
  client = createClient()
  jest.spyOn(client.node.connection, 'disconnect')

  let last = Date.now() - client.leaderTimeout - 10
  localStorage.setItem('logux:false:leader', `["",${ last }]`)

  client.start()
  expect(client.role).toEqual('candidate')
  await delay(client.electionDelay + 10)
  expect(client.role).toEqual('leader')
  expect(client.watching).toBeUndefined()
  await delay(client.leaderPing + 10)
  let data = JSON.parse(localStorage.getItem('logux:false:leader'))
  expect(data[0]).toEqual(client.tabId)
  expect(Date.now() - data[1]).toBeLessThan(100)

  emitStorage('logux:false:leader', `["",${ Date.now() }]`)
  expect(client.role).toEqual('follower')
  expect(client.watching).toBeDefined()
})

it('has random timeout', () => {
  let client1 = createClient()
  let client2 = createClient()
  expect(client1.roleTimeout).not.toEqual(client2.roleTimeout)
})

it('replaces dead leader', async () => {
  client = createClient()
  client.roleTimeout = client.leaderTimeout / 2

  localStorage.setItem('logux:false:leader', `["",${ Date.now() }]`)
  client.start()

  await delay(client.roleTimeout)
  expect(client.role).toEqual('follower')
  await delay(client.leaderTimeout + client.roleTimeout)
  expect(client.role).not.toEqual('follower')
})

it('disconnects on leader changes', async () => {
  client = createClient()
  jest.spyOn(client.node.connection, 'disconnect')

  client.start()
  await delay(client.electionDelay + 10)
  client.node.state = 'connected'

  let now = Date.now()
  localStorage.setItem('logux:false:leader', `["",${ now }]`)
  emitStorage('logux:false:leader', `["",${ now }]`)

  expect(client.node.connection.disconnect).toHaveBeenCalledTimes(1)
})

it('updates state if tab is a leader', async () => {
  client = createClient()

  client.start()
  expect(client.state).toEqual('disconnected')

  await delay(client.electionDelay + 10)
  client.node.state = 'synchronized'
  client.node.emitter.emit('state')
  expect(client.state).toEqual('synchronized')
  expect(localStorage.getItem('logux:false:state')).toEqual('"synchronized"')
})

it('listens for leader state', () => {
  localStorage.setItem('logux:false:leader', `["",${ Date.now() }]`)
  localStorage.setItem('logux:false:state', '"connecting"')

  client = createClient()
  let states = []
  client.on('state', () => {
    states.push(client.state)
  })
  client.start()
  expect(states).toEqual(['connecting'])

  localStorage.removeItem('logux:false:state')
  emitStorage('logux:false:state', null)
  expect(states).toEqual(['connecting'])

  localStorage.setItem('logux:false:state', '"synchronized"')
  emitStorage('logux:false:state', null)
  emitStorage('logux:false:state', '"sending"')
  emitStorage('logux:false:state', '"synchronized"')
  expect(states).toEqual(['connecting', 'synchronized'])
})

it('has connected shortcut', () => {
  client = createClient()
  expect(client.connected).toBe(false)
  client.state = 'connecting'
  expect(client.connected).toBe(false)
  client.state = 'sending'
  expect(client.connected).toBe(true)
})

it('works on IE storage event', async () => {
  client = createClient()

  let events = 0
  client.on('add', () => {
    events += 1
  })
  client.on('clean', () => {
    events += 1
  })

  client.start()
  emitStorage('logux:false:leader', localStorage.getItem('logux:false:leader'))

  await delay(client.electionDelay + 10)
  expect(client.role).toEqual('leader')

  emitStorage('logux:false:add', `["${ client.tabId }",{},{"id":"0 A 0"}]`)
  emitStorage('logux:false:clean', `["${ client.tabId }",{},{"id":"0 A 0"}]`)
  expect(events).toEqual(0)
})

it('sends unleader event on tab closing', async () => {
  client = createClient()
  client.start()
  await delay(client.electionDelay + 10)
  window.dispatchEvent(new Event('unload'))
  expect(localStorage.getItem('logux:false:leader')).toEqual('[]')
})

it('sends unleader event on destroy', async () => {
  client = createClient()
  client.start()
  await delay(client.electionDelay + 10)
  client.destroy()
  expect(localStorage.getItem('logux:false:leader')).toEqual('[]')
})

it('does not sends event on tab closing in following mode', async () => {
  client = createClient()

  let prevLeader = `["",${ Date.now() }]`
  localStorage.setItem('logux:false:leader', prevLeader)
  client.start()

  await delay(client.electionDelay + 10)
  expect(localStorage.getItem('logux:false:leader')).toEqual(prevLeader)
})

it('starts election on leader unload', async () => {
  client = createClient()

  localStorage.setItem('logux:false:leader', `["",${ Date.now() }]`)
  localStorage.setItem('logux:false:state', '"synchronized"')

  client.start()
  await delay(client.electionDelay + 10)
  emitStorage('logux:false:leader', '[]')
  expect(client.role).toEqual('candidate')
  expect(client.state).toEqual('disconnected')
  expect(localStorage.getItem('logux:false:state')).toEqual('"disconnected"')
  expect(localStorage.getItem('logux:false:leader')).toContain(client.tabId)
})

it('changes state on dead leader', () => {
  client = createClient()

  let last = Date.now() - client.leaderTimeout - 1
  localStorage.setItem('logux:false:leader', `["",${ last }]`)
  localStorage.setItem('logux:false:state', '"connecting"')

  client.start()
  expect(client.state).toEqual('disconnected')
})

it('changes state on leader death', async () => {
  client = createClient()
  client.roleTimeout = 20

  let last = Date.now() - client.leaderTimeout + 10
  localStorage.setItem('logux:false:leader', `["",${ last }]`)
  localStorage.setItem('logux:false:state', '"sending"')

  client.start()
  await delay(client.roleTimeout + 20)
  expect(client.state).toEqual('disconnected')
  expect(localStorage.getItem('logux:false:state')).toEqual('"disconnected"')
})

it('cleans tab-specific action after timeout', async () => {
  client = createClient()
  await client.log.add({ type: 'A' }, { reasons: ['tab1'] })
  localStorage.setItem('logux:tab:1', Date.now() - client.tabTimeout - 1)
  client.start()
  await delay(1)
  expect(client.log.actions()).toHaveLength(0)
})

it('detects subscriptions from different tabs', () => {
  client = createClient()
  emitStorage('logux:false:add', '["other",' +
    '{"type":"logux/subscribe","name":"a"},' +
    '{"sync":true,"id":"0 A 0","reasons":["syncing"]}' +
  ']')
  emitStorage('logux:false:add', '["other",' +
    '{"type":"logux/processed","id":"0 A 0"},{"id":"1 A 0"}' +
  ']')
  expect(client.subscriptions).toEqual({
    '{"type":"logux/subscribe","name":"a"}': 1
  })
})

it('copies actions on memory store', () => {
  client = createClient()

  emitStorage('logux:false:add', '["other",{"type":"A"},{"id":"1 A 0"}]')
  expect(client.log.actions()).toEqual([{ type: 'A' }])

  emitStorage('logux:false:clean', '["other",{"type":"A"},{"id":"1 A 0"}]')
  expect(client.log.actions()).toHaveLength(0)
})
