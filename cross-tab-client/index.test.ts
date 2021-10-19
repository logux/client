import { TestLog, TestPair, TestTime, Action } from '@logux/core'
import { delay } from 'nanodelay'
import { jest } from '@jest/globals'

import {
  breakLocalStorage,
  setLocalStorage,
  emitStorage
} from '../test/local-storage.js'
import { CrossTabClient, ClientOptions } from '../index.js'

declare global {
  namespace NodeJS {
    interface Global {
      WebSocket: any
    }
  }
}

beforeEach(() => {
  class WebSocket {
    close(): void {}
  }
  global.WebSocket = WebSocket as any
  setLocalStorage()
})

const ELECTION_DELAY = 1000 / 20
const LEADER_TIMEOUT = 5000 / 20
const LEADER_PING = 2000 / 20

let client: CrossTabClient<{}, TestLog>
let originWebSocket = global.WebSocket
afterEach(() => {
  client.destroy()
  global.WebSocket = originWebSocket
})

function privateMethods(obj: object): any {
  return obj
}

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

function createClient(
  overrides: Partial<ClientOptions> = {}
): CrossTabClient<{}, TestLog> {
  let result = new CrossTabClient<{}, TestLog>({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10',
    time: new TestTime(),
    ...overrides
  })
  privateMethods(result).electionDelay = ELECTION_DELAY
  privateMethods(result).leaderTimeout = LEADER_TIMEOUT
  privateMethods(result).leaderPing = LEADER_PING
  return result
}

it('saves options', () => {
  client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  expect(client.options.subprotocol).toBe('1.0.0')
})

it('saves client ID', () => {
  client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  let another = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  expect(client.clientId).toEqual(another.clientId)
})

it('supports nanoevents API', async () => {
  client = createClient()

  let twice: string[] = []
  let c: string[] = []
  let preadd: string[] = []
  let preaddC: string[] = []
  let id: string[] = []
  client.on('preadd', action => {
    preadd.push(action.type)
  })
  client.type(
    'C',
    action => {
      preaddC.push(action.type)
    },
    { event: 'preadd' }
  )
  let unbindType = client.type('C', action => {
    c.push(action.type)
  })
  client.type(
    'D',
    action => {
      id.push(action.type)
    },
    { id: 'ID' }
  )
  let unbindAdd = client.on('add', action => {
    twice.push(action.type)
    if (action.type === 'B') unbindAdd()
  })

  await client.log.add({ type: 'A' })
  await client.log.add({ type: 'B' })
  await client.log.add({ type: 'C' })
  await client.log.add({ type: 'C' })
  unbindType()
  await client.log.add({ type: 'C' })
  await client.log.add({ type: 'D', id: 'ID' })
  await client.log.add({ type: 'D', id: 'Other' })
  expect(preadd).toEqual(['A', 'B', 'C', 'C', 'C', 'D', 'D'])
  expect(twice).toEqual(['A', 'B'])
  expect(c).toEqual(['C', 'C'])
  expect(preaddC).toEqual(['C', 'C', 'C'])
  expect(id).toEqual(['D'])
})

it('cleans everything', async () => {
  client = createClient()

  jest.spyOn(client.node, 'destroy')
  jest.spyOn(localStorage, 'removeItem')

  await client.clean()
  expect(client.node.destroy).toHaveBeenCalledTimes(1)
  expect(localStorage.removeItem).toHaveBeenCalledTimes(4)
  expect(localStorage.removeItem).toHaveBeenNthCalledWith(1, 'logux:10:add')
  expect(localStorage.removeItem).toHaveBeenNthCalledWith(2, 'logux:10:state')
  expect(localStorage.removeItem).toHaveBeenNthCalledWith(3, 'logux:10:client')
  expect(localStorage.removeItem).toHaveBeenNthCalledWith(4, 'logux:10:leader')
})

it('does not use broken localStorage', async () => {
  breakLocalStorage(new Error('The quota has been exceeded'))
  client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  await client.log.add({ type: 'A' }, { reasons: ['tab' + client.tabId] })
})

it('synchronizes actions between tabs', async () => {
  localStorage.setItem = (name, value) => {
    emitStorage(name, value)
  }
  client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  let client2 = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '10'
  })
  let client3 = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    prefix: 'other',
    userId: '10'
  })
  let client4 = new CrossTabClient({
    subprotocol: '1.0.0',
    server: 'wss://localhost:1337',
    userId: '20'
  })

  let events: [string, Action, string[]][] = []
  client.type('A', (action, meta) => {
    events.push(['A', action, meta.reasons])
  })
  client.on('add', (action, meta) => {
    events.push(['add', action, meta.reasons])
  })
  client.on('clean', (action, meta) => {
    events.push(['clean', action, meta.reasons])
  })

  await client2.log.add({ type: 'A' })
  await client3.log.add({ type: 'B' })
  await client2.log.add({ type: 'C' }, { tab: client.tabId })
  await client2.log.add({ type: 'D' }, { tab: client2.tabId })
  await client4.log.add({ type: 'E' })
  expect(events).toEqual([
    ['A', { type: 'A' }, []],
    ['add', { type: 'A' }, []],
    ['add', { type: 'C' }, []]
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
    reasons: [],
    added: 1,
    time: 1,
    sync: true,
    id: '1 10:other 0'
  })
  emitStorage('logux:10:add', `["other",${action},${meta}]`)
  await delay(50)
  expect(pair.leftSent).toEqual([
    ['sync', 1, { type: 'A' }, { id: [1, '10:other', 0], time: 1 }]
  ])
})

it('uses candidate role from beggining', () => {
  client = createClient()
  expect(client.role).toBe('candidate')
})

it('becomes leader without localStorage', () => {
  Object.defineProperty(global, '_localStorage', { value: undefined })
  client = createClient()

  let roles: string[] = []
  client.on('role', () => {
    roles.push(client.role)
  })
  jest.spyOn(client.node.connection, 'connect')

  client.start()
  expect(roles).toEqual(['leader'])
  expect(client.node.connection.connect).toHaveBeenCalledTimes(1)
})

it('becomes follower on recent leader ping', () => {
  localStorage.setItem('logux:10:leader', `["",${Date.now()}]`)
  client = createClient()

  let roles: string[] = []
  client.on('role', () => {
    roles.push(client.role)
  })
  jest.spyOn(client.node.connection, 'connect')

  client.start()
  expect(roles).toEqual(['follower'])
  expect(client.node.connection.connect).not.toHaveBeenCalled()
  expect(privateMethods(client).watching).toBeDefined()
})

it('stops election on second candidate', async () => {
  client = createClient()

  client.start()
  expect(client.role).toBe('candidate')

  localStorage.setItem('logux:10:leader', `["",${Date.now() - 10}]`)
  await delay(ELECTION_DELAY + 10)
  expect(client.role).toBe('follower')
  expect(privateMethods(client).watching).toBeDefined()
})

it('stops election in leader check', async () => {
  client = createClient()

  client.start()
  expect(client.role).toBe('candidate')

  localStorage.setItem('logux:10:leader', `["",${Date.now()}]`)
  await delay(ELECTION_DELAY + 10)
  expect(client.role).toBe('follower')
  expect(privateMethods(client).watching).toBeDefined()
})

it('pings on leader role', async () => {
  client = createClient()
  jest.spyOn(client.node.connection, 'disconnect')

  let last = Date.now() - LEADER_TIMEOUT - 10
  localStorage.setItem('logux:10:leader', `["",${last}]`)

  client.start()
  expect(client.role).toBe('candidate')
  await delay(ELECTION_DELAY + 10)
  expect(client.role).toBe('leader')
  expect(privateMethods(client).watching).toBeUndefined()
  await delay(LEADER_PING + 10)
  let leader = localStorage.getItem('logux:10:leader')
  if (leader === null) throw new Error('Leader key was not set')
  let data = JSON.parse(leader)
  expect(data[0]).toEqual(client.tabId)
  expect(Date.now() - data[1]).toBeLessThan(100)

  emitStorage('logux:10:leader', `["",${Date.now()}]`)
  expect(client.role).toBe('follower')
  expect(privateMethods(client).watching).toBeDefined()
})

it('has random timeout', () => {
  let client1 = createClient()
  let client2 = createClient()
  expect(privateMethods(client1).roleTimeout).not.toEqual(
    privateMethods(client2).roleTimeout
  )
})

it('replaces dead leader', async () => {
  client = createClient()
  privateMethods(client).roleTimeout = LEADER_TIMEOUT / 2

  localStorage.setItem('logux:10:leader', `["",${Date.now()}]`)
  client.start()

  await delay(LEADER_TIMEOUT / 2)
  expect(client.role).toBe('follower')
  await delay(1.5 * LEADER_TIMEOUT)
  expect(client.role).not.toBe('follower')
})

it('disconnects on leader changes', async () => {
  client = createClient()
  jest.spyOn(client.node.connection, 'disconnect')

  client.start()
  await delay(ELECTION_DELAY + 10)
  client.node.state = 'synchronized'

  let now = Date.now()
  localStorage.setItem('logux:10:leader', `["",${now}]`)
  emitStorage('logux:10:leader', `["",${now}]`)

  expect(client.node.connection.disconnect).toHaveBeenCalledTimes(1)
})

it('updates state if tab is a leader', async () => {
  client = createClient()

  client.start()
  expect(client.state).toBe('disconnected')

  await delay(ELECTION_DELAY + 10)
  client.node.state = 'synchronized'
  emit(client.node, 'state')
  expect(client.state).toBe('synchronized')
  expect(localStorage.getItem('logux:10:state')).toBe('"synchronized"')
})

it('listens for leader state', () => {
  localStorage.setItem('logux:10:leader', `["",${Date.now()}]`)
  localStorage.setItem('logux:10:state', '"connecting"')

  client = createClient()
  let states: string[] = []
  client.on('state', () => {
    states.push(client.state)
  })
  client.start()
  expect(states).toEqual(['connecting'])

  localStorage.removeItem('logux:10:state')
  emitStorage('logux:10:state', null)
  expect(states).toEqual(['connecting'])

  localStorage.setItem('logux:10:state', '"synchronized"')
  emitStorage('logux:10:state', null)
  emitStorage('logux:10:state', '"sending"')
  emitStorage('logux:10:state', '"synchronized"')
  expect(states).toEqual(['connecting', 'synchronized'])
})

it('waits for specific state', async () => {
  localStorage.setItem('logux:10:leader', `["",${Date.now()}]`)
  localStorage.setItem('logux:10:state', '"connecting"')

  client = createClient()
  setTimeout(() => {
    localStorage.setItem('logux:10:state', '"synchronized"')
    emitStorage('logux:10:state', '"synchronized"')
  }, 10)
  await client.waitFor('synchronized')
  await client.waitFor('synchronized')
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

  client.start()
  emitStorage('logux:10:leader', localStorage.getItem('logux:10:leader'))

  await delay(ELECTION_DELAY + 10)
  expect(client.role).toBe('leader')

  emitStorage(
    'logux:10:add',
    `["${client.tabId}",{},{"id":"0 A 0","reasons":[]}]`
  )
  expect(events).toBe(0)
})

it('sends unleader event on tab closing', async () => {
  client = createClient()
  client.start()
  await delay(ELECTION_DELAY + 10)
  window.dispatchEvent(new Event('unload'))
  expect(localStorage.getItem('logux:10:leader')).toBe('[]')
})

it('sends unleader event on destroy', async () => {
  client = createClient()
  client.start()
  await delay(ELECTION_DELAY + 10)
  client.destroy()
  expect(localStorage.getItem('logux:10:leader')).toBe('[]')
})

it('does not sends event on tab closing in following mode', async () => {
  client = createClient()

  let prevLeader = `["",${Date.now()}]`
  localStorage.setItem('logux:10:leader', prevLeader)
  client.start()

  await delay(ELECTION_DELAY + 10)
  expect(localStorage.getItem('logux:10:leader')).toEqual(prevLeader)
})

it('starts election on leader unload', async () => {
  client = createClient()

  localStorage.setItem('logux:10:leader', `["",${Date.now()}]`)
  localStorage.setItem('logux:10:state', '"synchronized"')

  client.start()
  await delay(ELECTION_DELAY + 10)
  emitStorage('logux:10:leader', '[]')
  expect(client.role).toBe('candidate')
  expect(client.state).toBe('disconnected')
  expect(localStorage.getItem('logux:10:state')).toBe('"disconnected"')
  expect(localStorage.getItem('logux:10:leader')).toContain(client.tabId)
})

it('changes state on dead leader', () => {
  client = createClient()

  let last = Date.now() - LEADER_TIMEOUT - 1
  localStorage.setItem('logux:10:leader', `["",${last}]`)
  localStorage.setItem('logux:10:state', '"connecting"')

  client.start()
  expect(client.state).toBe('disconnected')
})

it('changes state on leader death', async () => {
  client = createClient()
  privateMethods(client).roleTimeout = 20

  let last = Date.now() - LEADER_TIMEOUT + 10
  localStorage.setItem('logux:10:leader', `["",${last}]`)
  localStorage.setItem('logux:10:state', '"sending"')

  client.start()
  await delay(30)
  expect(client.state).toBe('disconnected')
  expect(localStorage.getItem('logux:10:state')).toBe('"disconnected"')
})

it('cleans tab-specific action after timeout', async () => {
  client = createClient()
  let tabTimeout = privateMethods(client).tabTimeout
  await client.log.add({ type: 'A' }, { reasons: ['tab1'] })
  localStorage.setItem('logux:tab:1', `${Date.now() - tabTimeout - 1}`)
  client.start()
  await delay(1)
  expect(client.log.actions()).toHaveLength(0)
})

it('detects subscriptions from different tabs', () => {
  client = createClient()
  emitStorage(
    'logux:10:add',
    '["other",' +
      '{"type":"logux/subscribe","name":"a"},' +
      '{"sync":true,"id":"0 A 0","reasons":["syncing"]}' +
      ']'
  )
  emitStorage(
    'logux:10:add',
    '["other",' +
      '{"type":"logux/processed","id":"0 A 0"},{"id":"1 A 0","reasons":[]}' +
      ']'
  )
  expect(privateMethods(client).subscriptions).toEqual({
    '{"type":"logux/subscribe","name":"a"}': 1
  })
})

it('copies actions on memory store', () => {
  client = createClient()
  emitStorage(
    'logux:10:add',
    '["other",{"type":"A"},{"id":"1 A 0","reasons":[]}]'
  )
  expect(client.log.actions()).toEqual([{ type: 'A' }])
})

it('detects higher subprotocol from other tab', () => {
  client = createClient()
  expect(localStorage.storage['logux:10:subprotocol']).toBe('"1.0.0"')

  let error: Error | undefined
  client.node.on('error', e => {
    error = e
  })
  emitStorage('logux:10:subprotocol', '"1.0.1"')
  expect(error?.toString()).toContain(
    'Only 1.0.1 application subprotocols are supported, but you use 1.0.0'
  )
})

it('detects lower subprotocol from other tab', () => {
  client = createClient()
  emitStorage('logux:10:subprotocol', '"0.9.9"')
  expect(localStorage.storage['logux:10:subprotocol']).toBe('"1.0.0"')
})

it('detects the same subprotocol from other tab', () => {
  client = createClient()
  emitStorage('logux:10:subprotocol', '"1.0.0"')
  expect(localStorage.storage['logux:10:subprotocol']).toBe('"1.0.0"')
})

it('does not show alert on higher subprotocol', () => {
  client = createClient()
  let error
  client.node.on('error', e => {
    error = e
  })
  emitStorage(
    'logux:10:add',
    '["other",{"type":"A"},' +
      '{"id":"1 ' +
      client.nodeId +
      ' 0","reasons":[],"subprotocol":"1.0.0"}]'
  )
  emitStorage(
    'logux:10:add',
    '["other",{"type":"A"},' +
      '{"id":"1 ' +
      client.nodeId +
      ' 0","reasons":[],"subprotocol":"0.9.0"}]'
  )
  expect(error).toBeUndefined()
})

it('ignores non-digit subprotocols', () => {
  client = createClient({ subprotocol: '1.0.0-beta' })
  let error
  client.node.on('error', e => {
    error = e
  })
  emitStorage(
    'logux:10:add',
    '["other",{"type":"A"},' +
      '{"id":"1 ' +
      client.nodeId +
      ' 0","reasons":[],"subprotocol":"1.0.0"}]'
  )
  expect(error).toBeUndefined()
})

it('ignores subprotocols from server', () => {
  client = createClient()
  let error
  client.node.on('error', e => {
    error = e
  })
  emitStorage(
    'logux:10:add',
    '["other",{"type":"A"},' +
      '{"id":"1 10:other 0","reasons":[],"subprotocol":"2.0.0"}]'
  )
  expect(error).toBeUndefined()
})

it('disables cross-tab communication on localStorage error', async () => {
  client = createClient()
  client.start()

  localStorage.setItem('logux:10:leader', `["",${Date.now() - 10}]`)
  await delay(ELECTION_DELAY + 10)

  let error = new Error('test')
  jest.spyOn(console, 'error').mockImplementation(() => true)
  jest.spyOn(client.node.connection, 'connect')
  breakLocalStorage(error)
  client.log.add({ type: 'A' })

  expect(client.role).toBe('leader')
  expect(console.error).toHaveBeenCalledWith(error)
  expect(client.node.connection.connect).toHaveBeenCalledTimes(1)

  client.log.add({ type: 'B' })
  expect(console.error).toHaveBeenCalledTimes(1)
})

it('notifies other tabs on user change', () => {
  client = createClient()
  let users: string[] = []
  client.on('user', userId => {
    users.push(userId)
  })
  client.changeUser('20')
  expect(localStorage.getItem('logux:10:user')).toEqual(
    `["${client.tabId}","20"]`
  )
  expect(localStorage.getItem('logux:20:client')).toEqual(
    client.clientId.split(':')[1]
  )
  expect(users).toEqual(['20'])
})

it('sends event on user changing in other tab', () => {
  client = createClient()
  let users: string[] = []
  client.on('user', userId => {
    users.push(userId)
  })
  emitStorage('logux:10:user', `["other","20"]`)
  expect(users).toEqual(['20'])
})
