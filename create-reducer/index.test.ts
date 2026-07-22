import { defineAction } from '@logux/actions'
import { delay } from 'nanodelay'
import { afterEach, beforeAll, beforeEach, expect, it, describe } from 'vitest'

import {
  type ClientMeta,
  createReducer,
  createStorageReducer,
  TestClient
} from '../index.js'
import { setLocalStorage } from '../test/local-storage.js'

beforeAll(() => {
  setLocalStorage()
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: null
  })
})

function emitStorage(key: string, newValue: string): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

describe('createReducer', () => {
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
    expect(localStorage.getItem('logux:reducer:db')).toBeNull()

    await delay(1)
    expect(reducer.status.get()).toBe('initializing')
    expect(localStorage.getItem('logux:reducer:db')).toBeNull()

    resolveInit()
    await delay(1)
    expect(reducer.status.get()).toBe('ready')
    expect(String(localStorage.getItem('logux:reducer:db'))).toBe('1')
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
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')

    await client.log.add({ id: '1', type: 'users/create' })
    await delay(1)
    expect(calls).toEqual(['clean:start'])
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')

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
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')

    await client.log.add({ id: '2', type: 'users/create' })
    await delay(1)
    expect(calls).toEqual(['clean:start', 'clean:end', 'init:start'])
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')

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
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')

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

    resolveListener['a']!()
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
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')

    resolveListener['b']!()
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
    expect(localStorage.getItem('logux:reducer:db')).toBe('2')

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

    resolveListener['1']!()
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

    resolveListener['2']!()
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

    resolveListener['mid']!()
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

    resolveListener['3']!()
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

  it('runs reducer only in leader tab and releases lock on new version', async () => {
    let lockCallbacks: (() => Promise<unknown>)[] = []
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request(_name: string, fn: () => Promise<unknown>) {
          lockCallbacks.push(fn)
        }
      }
    })

    let client = new TestClient('10')
    await client.connect()

    let stopCalled = 0
    let reducer = createReducer(client, 'db', 1, {
      clean() {},
      stop() {
        stopCalled += 1
      }
    })
    let received: string[] = []
    reducer.type('users/create', action => {
      received.push(action.type)
    })

    await delay(1)
    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual([])

    let lockReleased = false
    void lockCallbacks[0]!().then(() => {
      lockReleased = true
    })
    await delay(1)

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])
    expect(lockReleased).toBe(false)

    emitStorage('logux:reducer:db', '2')
    await delay(1)
    expect(reducer.status.get()).toBe('outdated')
    expect(stopCalled).toBe(1)
    expect(lockReleased).toBe(true)

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])
  })
})

type IncAction = { amount: number; type: 'inc' }

function counterCallbacks(repeatEntries: [IncAction, ClientMeta][] = []): {
  decode: (s: string) => number
  encode: (v: number) => string
  repeat: () => [IncAction, ClientMeta][]
} {
  return {
    decode: s => parseInt(s, 10),
    encode: v => String(v),
    repeat: () => repeatEntries
  }
}

describe('createStorageReducer', () => {
  it('reduces actions into value and saves it', async () => {
    let client = new TestClient('10')
    await client.connect()

    let reducer = createStorageReducer(
      client,
      'counter',
      1,
      0,
      counterCallbacks()
    )
    reducer.type<IncAction>('inc', (prev, action) => prev + action.amount)

    expect(reducer.value.get()).toBe(0)
    await delay(1)
    expect(reducer.status.get()).toBe('ready')

    await client.log.add({ amount: 2, type: 'inc' })
    await client.log.add({ amount: 3, type: 'inc' })
    await delay(1)

    expect(reducer.value.get()).toBe(5)
    expect(localStorage.getItem('counter')).toBe('5')
  })

  it('loads value from localStorage on startup', () => {
    let client = new TestClient('10')
    localStorage.setItem('logux:reducer:counter', '1')
    localStorage.setItem('counter', '42')

    let reducer = createStorageReducer(
      client,
      'counter',
      1,
      0,
      counterCallbacks()
    )

    expect(reducer.value.get()).toBe(42)
  })

  it('syncs value from other tabs via storage events', async () => {
    let client = new TestClient('10')
    await client.connect()

    let reducer = createStorageReducer(
      client,
      'counter',
      1,
      0,
      counterCallbacks()
    )
    await delay(1)
    expect(reducer.value.get()).toBe(0)

    emitStorage('counter', '7')
    expect(reducer.value.get()).toBe(7)

    emitStorage('counter', '9')
    expect(reducer.value.get()).toBe(9)
  })

  it('replays repeat() actions during migration', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:counter', '1')
    localStorage.setItem('counter', '100')

    let entries: [IncAction, ClientMeta][] = [
      [
        { amount: 1, type: 'inc' },
        { id: 'a', time: 0, added: 0, reasons: [] }
      ],
      [
        { amount: 4, type: 'inc' },
        { id: 'b', time: 1, added: 0, reasons: [] }
      ]
    ]

    let reducer = createStorageReducer(
      client,
      'counter',
      2,
      0,
      counterCallbacks(entries)
    )
    reducer.type<IncAction>('inc', (prev, action) => prev + action.amount)

    expect(reducer.status.get()).toBe('updating')
    await delay(1)
    expect(reducer.status.get()).toBe('ready')
    expect(reducer.value.get()).toBe(5)
    expect(localStorage.getItem('counter')).toBe('5')
  })

  it('works with string-only overload', async () => {
    let client = new TestClient('10')
    await client.connect()

    let reducer = createStorageReducer(client, 'msg', 1, '', {
      repeat: () => []
    })
    reducer.type<{ text: string; type: 'set' }>(
      'set',
      (_, action) => action.text
    )

    expect(reducer.value.get()).toBe('')
    await delay(1)

    await client.log.add({ text: 'hello', type: 'set' })
    await delay(1)

    expect(reducer.value.get()).toBe('hello')
    expect(localStorage.getItem('msg')).toBe('hello')
  })
})
