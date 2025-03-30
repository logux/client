import { type Action, type TestLog, TestPair, TestTime } from '@logux/core'
import { delay } from 'nanodelay'
import { restoreAll, spyOn } from 'nanospy'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { type ClientOptions, CrossTabClient } from '../index.js'
import {
  breakLocalStorage,
  emitStorage,
  setLocalStorage
} from '../test/local-storage.js'

class WebSocket {
  close(): void {}
}

let lockRequest: (() => Promise<void>) | undefined

beforeEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request(name: string, fn: () => Promise<void>) {
        lockRequest = fn
      }
    }
  })
  global.WebSocket = WebSocket as any
  setLocalStorage()
})

let client: CrossTabClient<object, TestLog>
let originWebSocket = global.WebSocket
afterEach(() => {
  client.destroy()
  global.WebSocket = originWebSocket
  restoreAll()
})

let lockReturned = false

function giveLock(): void {
  lockReturned = false
  if (lockRequest) {
    lockRequest().then(() => {
      lockReturned = true
    })
  } else {
    throw new Error('Lock was not requested')
  }
}

function privateMethods(obj: object): any {
  return obj
}

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

function createClient(
  overrides: Partial<ClientOptions> = {}
): CrossTabClient<object, TestLog> {
  let result = new CrossTabClient<object, TestLog>({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    time: new TestTime(),
    userId: '10',
    ...overrides
  })
  return result
}

it('saves options', () => {
  client = new CrossTabClient({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  expect(client.options.subprotocol).toBe('1.0.0')
})

it('saves client ID', () => {
  client = new CrossTabClient({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  let another = new CrossTabClient({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
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
  await client.log.add({ id: 'ID', type: 'D' })
  await client.log.add({ id: 'Other', type: 'D' })
  expect(preadd).toEqual(['A', 'B', 'C', 'C', 'C', 'D', 'D'])
  expect(twice).toEqual(['A', 'B'])
  expect(c).toEqual(['C', 'C'])
  expect(preaddC).toEqual(['C', 'C', 'C'])
  expect(id).toEqual(['D'])
})

it('cleans everything', async () => {
  client = createClient()

  let destroy = spyOn(client.node, 'destroy')
  let removeItem = spyOn(localStorage, 'removeItem')

  await client.clean()
  expect(destroy.callCount).toEqual(1)
  expect(removeItem.calls).toEqual([
    ['logux:10:add'],
    ['logux:10:state'],
    ['logux:10:client']
  ])
})

it('does not use broken localStorage', async () => {
  breakLocalStorage(new Error('The quota has been exceeded'))
  client = new CrossTabClient({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  await client.log.add({ type: 'A' }, { reasons: ['tab' + client.tabId] })
})

it('synchronizes actions between tabs', async () => {
  localStorage.setItem = (name, value) => {
    emitStorage(name, value)
  }
  client = new CrossTabClient({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  let client2 = new CrossTabClient({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  let client3 = new CrossTabClient({
    prefix: 'other',
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
    userId: '10'
  })
  let client4 = new CrossTabClient({
    server: 'wss://localhost:1337',
    subprotocol: '1.0.0',
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
  giveLock()
  await pair.wait('left')
  pair.right.send(['connected', client.node.localProtocol, 'server', [0, 0]])
  await client.node.waitFor('synchronized')
  await delay(1)
  pair.clear()
  client.node.timeFix = 0
  let action = JSON.stringify({ type: 'A' })
  let meta = JSON.stringify({
    added: 1,
    id: '1 10:other 0',
    reasons: [],
    sync: true,
    time: 1
  })
  emitStorage('logux:10:add', `["other",${action},${meta}]`)
  await delay(50)
  expect(pair.leftSent).toEqual([
    ['sync', 1, { type: 'A' }, { id: [1, '10:other', 0], time: 1 }]
  ])
})

it('uses follower role from beginning', () => {
  client = createClient()
  expect(client.role).toBe('follower')
})

it('becomes leader without localStorage', () => {
  // @ts-expect-error
  window.localStorage = undefined
  client = createClient()

  let roles: string[] = []
  client.on('role', () => {
    roles.push(client.role)
  })
  let connect = spyOn(client.node.connection, 'connect')

  client.start()
  expect(roles).toEqual(['leader'])
  expect(connect.callCount).toEqual(1)
})

it('avoids connection on request', () => {
  // @ts-expect-error
  window.localStorage = undefined
  client = createClient()
  let connect = spyOn(client.node.connection, 'connect')
  client.start(false)
  expect(connect.called).toBe(false)
})

it('becomes leader without Web Locks', () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: null
  })
  client = createClient()

  let roles: string[] = []
  client.on('role', () => {
    roles.push(client.role)
  })
  let connect = spyOn(client.node.connection, 'connect')

  client.start()
  expect(roles).toEqual(['leader'])
  expect(connect.callCount).toEqual(1)
})

it('becomes follower on taken lock', () => {
  client = createClient()

  let roles: string[] = []
  client.on('role', () => {
    roles.push(client.role)
  })
  let connect = spyOn(client.node.connection, 'connect')

  client.start()
  expect(roles).toEqual([])
  expect(connect.called).toBe(false)
})

it('updates state if tab is a leader', () => {
  client = createClient()

  client.start()
  giveLock()
  expect(client.state).toBe('connecting')

  client.node.state = 'synchronized'
  emit(client.node, 'state')
  expect(client.state).toBe('synchronized')
  expect(localStorage.getItem('logux:10:state')).toBe('"synchronized"')
})

it('listens for leader state', () => {
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

it('returns lock on destroy', async () => {
  client = createClient()
  client.start()
  giveLock()
  expect(lockReturned).toBe(false)

  client.destroy()
  expect(client.role).toEqual('follower')
  await Promise.resolve()
  expect(lockReturned).toBe(true)
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

it('disables cross-tab communication on localStorage error', () => {
  client = createClient()
  client.start()

  let error = new Error('test')
  let errorLog = spyOn(console, 'error', () => {})
  let connect = spyOn(client.node.connection, 'connect')
  breakLocalStorage(error)
  client.log.add({ type: 'A' })

  expect(client.role).toBe('leader')
  expect(errorLog.calls).toEqual([[error]])
  expect(connect.callCount).toEqual(1)

  client.log.add({ type: 'B' })
  expect(errorLog.callCount).toEqual(1)
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
