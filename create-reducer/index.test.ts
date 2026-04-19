import { defineAction } from '@logux/actions'
import { delay } from 'nanodelay'
import { beforeAll, beforeEach, expect, it } from 'vitest'

import { type ClientMeta, createReducer, TestClient } from '../index.js'
import { setLocalStorage } from '../test/local-storage.js'

beforeAll(() => {
  setLocalStorage()
})

beforeEach(() => {
  localStorage.clear()
})

function emitStorage(key: string, newValue: string): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

it('waits for async init on first run before switching to ready', async () => {
  let client = new TestClient('10')

  let resolveInit: () => void = () => {}
  let reducer = createReducer(client, 'db', 1, {
    init() {
      return new Promise<void>(resolve => {
        resolveInit = resolve
      })
    },
    clean() {}
  })
  expect(reducer.status.get()).toBe('initializing')
  expect(String(localStorage.getItem('logux:reducer:db'))).toBe('1')

  await delay(1)
  expect(reducer.status.get()).toBe('initializing')

  resolveInit()
  await delay(1)
  expect(reducer.status.get()).toBe('ready')
})

it('skips migration when version matches', async () => {
  let client = new TestClient('10')
  localStorage.setItem('logux:reducer:db', '2')

  let initCalled = 0
  let cleanCalled = 0
  let reducer = createReducer(client, 'db', 2, {
    clean() {
      cleanCalled += 1
    },
    init() {
      initCalled += 1
    }
  })

  await delay(1)
  expect(initCalled).toBe(0)
  expect(cleanCalled).toBe(0)
  expect(reducer.status.get()).toBe('ready')
})

it('runs clean and init when version is higher than stored', async () => {
  let client = new TestClient('10')
  localStorage.setItem('logux:reducer:db', '1')

  let calls: string[] = []
  let reducer = createReducer(client, 'db', 3, {
    clean(oldVersion) {
      calls.push(`clean:${oldVersion}`)
    },
    init() {
      calls.push('init')
    }
  })

  expect(reducer.status.get()).toBe('updating')
  await delay(1)
  expect(calls).toEqual(['clean:1', 'init'])
  expect(reducer.status.get()).toBe('ready')
})

it('calls stop and sets status to outdated when version is older', () => {
  let client = new TestClient('10')
  localStorage.setItem('logux:reducer:db', '5')

  let stopCalled = 0
  let initCalled = 0
  let reducer = createReducer(client, 'db', 2, {
    init() {
      initCalled += 1
    },
    stop() {
      stopCalled += 1
    },
    clean() {}
  })

  expect(reducer.status.get()).toBe('outdated')
  expect(stopCalled).toBe(1)
  expect(initCalled).toBe(0)
})

it('works without optional callbacks', async () => {
  let client = new TestClient('10')
  let reducer = createReducer(client, 'db', 1, { clean() {} })

  await delay(1)
  expect(reducer.status.get()).toBe('ready')
})

it('reacts to storage events only when version is higher', async () => {
  let client = new TestClient('10')
  localStorage.setItem('logux:reducer:db', '1')

  let stopCalled = 0
  let reducer = createReducer(client, 'db', 1, {
    stop() {
      stopCalled += 1
    },
    clean() {}
  })
  await delay(1)
  expect(reducer.status.get()).toBe('ready')

  emitStorage('logux:reducer:db', '1')
  emitStorage('logux:reducer:db', '0')
  expect(reducer.status.get()).toBe('ready')
  expect(stopCalled).toBe(0)

  emitStorage('logux:reducer:db', '2')
  expect(reducer.status.get()).toBe('outdated')
  expect(stopCalled).toBe(1)
})

it('runs listener for actions after ready', async () => {
  let client = new TestClient('10')
  await client.connect()

  let reducer = createReducer(client, 'db', 1, { clean() {} })
  let received: string[] = []
  reducer.type('users/create', action => {
    received.push(action.type)
  })

  await delay(1)
  await client.log.add({ type: 'users/create' })
  await delay(1)
  expect(received).toEqual(['users/create'])
})

it('accepts action creator in type()', async () => {
  let client = new TestClient('10')
  await client.connect()

  let reducer = createReducer(client, 'db', 1, { clean() {} })
  let createUser = defineAction<{ id: string; type: 'users/create' }>(
    'users/create'
  )

  let received: string[] = []
  reducer.type(createUser, action => {
    received.push(action.id)
  })

  await delay(1)
  await client.log.add({ id: '1', type: 'users/create' })
  await delay(1)
  expect(received).toEqual(['1'])
})

it('runs events on order', async () => {
  let client = new TestClient('10')
  await client.connect()
  localStorage.setItem('logux:reducer:db', '1')

  type UserAction = { id: string; type: 'users/create' }

  let resolveClean!: (entries: [UserAction, ClientMeta][]) => void
  let resolveInit: () => void = () => {}
  let resolveListener: Record<string, () => void> = {}
  let calls: string[] = []

  let reducer = createReducer(client, 'db', 2, {
    clean() {
      calls.push('clean:start')
      return new Promise<[UserAction, ClientMeta][]>(resolve => {
        resolveClean = entries => {
          calls.push('clean:end')
          resolve(entries)
        }
      })
    },
    init() {
      calls.push('init:start')
      return new Promise<void>(resolve => {
        resolveInit = () => {
          calls.push('init:end')
          resolve()
        }
      })
    }
  })

  reducer.type<UserAction>('users/create', action => {
    calls.push(`action:${action.id}:start`)
    return new Promise<void>(resolve => {
      resolveListener[action.id] = () => {
        calls.push(`action:${action.id}:end`)
        resolve()
      }
    })
  })

  expect(reducer.status.get()).toBe('updating')
  await delay(1)
  expect(calls).toEqual(['clean:start'])

  await client.log.add({ id: '1', type: 'users/create' })
  await delay(1)
  expect(calls).toEqual(['clean:start'])

  resolveClean([
    [
      { id: 'a', type: 'users/create' },
      { id: 'a', time: 0, added: 0, reasons: [] }
    ],
    [
      { id: 'b', type: 'users/create' },
      { id: 'b', time: 1, added: 0, reasons: [] }
    ]
  ] satisfies [UserAction, ClientMeta][])
  await delay(1)
  expect(calls).toEqual(['clean:start', 'clean:end', 'init:start'])

  await client.log.add({ id: '2', type: 'users/create' })
  await delay(1)
  expect(calls).toEqual(['clean:start', 'clean:end', 'init:start'])

  resolveInit()
  await delay(1)
  expect(reducer.status.get()).toBe('updating')
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start'
  ])

  // add action while clean entry a is still running — should be buffered
  await client.log.add({ id: 'mid', type: 'users/create' })
  await delay(1)
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start'
  ])

  resolveListener['a']()
  await delay(1)
  expect(reducer.status.get()).toBe('updating')
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start',
    'action:a:end',
    'action:b:start'
  ])

  resolveListener['b']()
  await delay(1)
  expect(reducer.status.get()).toBe('ready')
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start',
    'action:a:end',
    'action:b:start',
    'action:b:end',
    'action:1:start'
  ])

  await client.log.add({ id: '3', type: 'users/create' })
  await delay(1)
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start',
    'action:a:end',
    'action:b:start',
    'action:b:end',
    'action:1:start'
  ])

  resolveListener['1']()
  await delay(1)
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start',
    'action:a:end',
    'action:b:start',
    'action:b:end',
    'action:1:start',
    'action:1:end',
    'action:2:start'
  ])

  resolveListener['2']()
  await delay(1)
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start',
    'action:a:end',
    'action:b:start',
    'action:b:end',
    'action:1:start',
    'action:1:end',
    'action:2:start',
    'action:2:end',
    'action:mid:start'
  ])

  resolveListener['mid']()
  await delay(1)
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start',
    'action:a:end',
    'action:b:start',
    'action:b:end',
    'action:1:start',
    'action:1:end',
    'action:2:start',
    'action:2:end',
    'action:mid:start',
    'action:mid:end',
    'action:3:start'
  ])

  resolveListener['3']()
  await delay(1)
  expect(calls).toEqual([
    'clean:start',
    'clean:end',
    'init:start',
    'init:end',
    'action:a:start',
    'action:a:end',
    'action:b:start',
    'action:b:end',
    'action:1:start',
    'action:1:end',
    'action:2:start',
    'action:2:end',
    'action:mid:start',
    'action:mid:end',
    'action:3:start',
    'action:3:end'
  ])
})
