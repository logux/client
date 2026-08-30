import { defineAction } from '@logux/actions'
import type { MetaTime } from '@logux/core'
import { delay } from 'nanodelay'
import { afterEach, beforeEach, expect, it, describe } from 'vitest'

import {
  type ClientMeta,
  createReducer,
  createStorageReducer,
  type PersistentStorage,
  TestClient
} from '../index.js'
import { setLocalStorage } from '../test/local-storage.js'

beforeEach(() => {
  setLocalStorage()
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

const DB_LOCK = 'logux:reducer:db:lock'

interface MockedLocks {
  /** Number of the requests cancelled by their `signal`. */
  aborted: number

  /**
   * Emulate another tab holding the lock. Returns the callback
   * to release it.
   */
  hold(name: string): () => void

  /** Is the lock held by somebody right now. */
  isHeld(name: string): boolean

  /** Number of the requests waiting in the queue for the lock. */
  waiting(name: string): number
}

/**
 * Emulate Web Locks API: the lock is granted in the next tick, `ifAvailable`
 * requests get `null` instead of waiting when the lock is held, and the rest
 * are queued until the lock will be released or their signal will be aborted.
 */
function mockLocks(): MockedLocks {
  let held = new Set<string>()
  let queues: Record<string, (() => void)[]> = {}

  function release(name: string): void {
    held.delete(name)
    let next = queues[name]?.shift()
    if (next) next()
  }

  function acquire(
    name: string,
    callback: (lock: unknown) => unknown
  ): Promise<unknown> {
    held.add(name)
    return Promise.resolve(callback({ name })).then(result => {
      release(name)
      return result
    })
  }

  let mocked: MockedLocks = {
    aborted: 0,
    hold(name) {
      held.add(name)
      let released = false
      return () => {
        if (released) return
        released = true
        release(name)
      }
    },
    isHeld(name) {
      return held.has(name)
    },
    waiting(name) {
      return queues[name]?.length ?? 0
    }
  }

  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request(
        name: string,
        opts: { ifAvailable?: boolean; signal?: AbortSignal },
        callback: (lock: unknown) => unknown
      ) {
        if (opts.ifAvailable) {
          // The real lock is never granted in the same tick as the request
          return delay(0).then(() => {
            return held.has(name) ? callback(null) : acquire(name, callback)
          })
        }
        return new Promise((resolve, reject) => {
          let request = (): void => {
            resolve(acquire(name, callback))
          }
          queues[name] ??= []
          opts.signal?.addEventListener('abort', () => {
            let index = queues[name]!.indexOf(request)
            if (index === -1) return
            queues[name]!.splice(index, 1)
            mocked.aborted += 1
            reject(new Error('AbortError'))
          })
          if (held.has(name)) {
            queues[name].push(request)
          } else {
            void delay(0).then(request)
          }
        })
      }
    }
  })

  return mocked
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

  it('builds the data from repeated actions on the first run', async () => {
    let client = new TestClient('10')
    await client.connect()

    type UserAction = { id: string; type: 'users/create' }

    let calls: string[] = []
    let migratingCalled = 0
    let reducer = createReducer(client, 'db', 2, {
      clean(oldVersion) {
        calls.push(`clean:${oldVersion}`)
        return [
          [
            { id: 'a', type: 'users/create' },
            { id: 'a', time: 0 }
          ],
          // The reducer has no listener for this action
          [
            { id: 'b', type: 'users/rename' },
            { id: 'b', time: 1 }
          ]
        ] satisfies [UserAction | { id: string; type: 'users/rename' }, MetaTime][]
      },
      init() {
        calls.push('init')
      },
      migrating() {
        migratingCalled += 1
      }
    })
    reducer.type<UserAction>('users/create', action => {
      calls.push(`action:${action.id}`)
    })

    // The log can be filled before the reducer was created, but the first
    // build is not a migration
    expect(reducer.status.get()).toBe('initializing')
    await reducer.ready
    expect(calls).toEqual(['clean:0', 'init', 'action:a'])
    expect(migratingCalled).toBe(0)
    expect(reducer.status.get()).toBe('ready')
    expect(localStorage.getItem('logux:reducer:db')).toBe('2')
  })

  it('saves the version only when the data was built', async () => {
    let client = new TestClient('10')
    await client.connect()

    let hasData = false
    let reducer = createReducer(client, 'db', 1, {
      clean() {},
      hasValue: () => hasData
    })
    reducer.type('users/create', () => {
      hasData = true
    })

    await reducer.ready
    expect(reducer.status.get()).toBe('ready')
    expect(localStorage.getItem('logux:reducer:db')).toBeNull()

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')
  })

  it('rebuilds the data when the version was stored without the data', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:db', '2')

    let calls: string[] = []
    let migratingCalled = 0
    let reducer = createReducer(client, 'db', 2, {
      clean(oldVersion) {
        calls.push(`clean:${oldVersion}`)
      },
      hasValue: () => false,
      init() {
        calls.push('init')
      },
      migrating() {
        migratingCalled += 1
      }
    })

    // The version without the data means the partially cleaned storage
    await reducer.ready
    expect(calls).toEqual(['clean:0', 'init'])
    expect(migratingCalled).toBe(0)
    expect(reducer.status.get()).toBe('ready')
  })

  it('becomes outdated by the newer version even without the data', () => {
    let client = new TestClient('10')
    localStorage.setItem('logux:reducer:db', '5')

    let cleanCalled = 0
    let stopCalled = 0
    let reducer = createReducer(client, 'db', 2, {
      clean() {
        cleanCalled += 1
      },
      hasValue: () => false,
      stop() {
        stopCalled += 1
      }
    })

    expect(reducer.status.get()).toBe('outdated')
    expect(cleanCalled).toBe(0)
    expect(stopCalled).toBe(1)
  })

  it('becomes ready when clean() fails and keeps the old version', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:db', '1')

    let reducer = createReducer(client, 'db', 2, {
      clean(): Promise<void> {
        return Promise.reject(new Error('The database was closed'))
      }
    })

    expect(reducer.status.get()).toBe('migrating')
    await reducer.ready
    expect(reducer.status.get()).toBe('ready')
    // The next start will build the data again
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')
  })

  it('does not become ready when the rebuild fails after destroy', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:db', '1')

    let rejectClean!: (error: Error) => void
    let reducer = createReducer(client, 'db', 2, {
      clean() {
        return new Promise<void>((resolve, reject) => {
          rejectClean = reject
        })
      }
    })

    expect(reducer.status.get()).toBe('migrating')
    reducer.destroy()
    rejectClean(new Error('The database was closed'))
    await delay(1)
    expect(reducer.status.get()).toBe('migrating')
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')
  })

  it('becomes ready when the actions replay fails', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:db', '1')

    type UserAction = { id: string; type: 'users/create' }

    let calls: string[] = []
    let reducer = createReducer(client, 'db', 2, {
      clean() {
        return [
          [
            { id: 'a', type: 'users/create' },
            { id: 'a', time: 0 }
          ],
          [
            { id: 'b', type: 'users/create' },
            { id: 'b', time: 1 }
          ]
        ] satisfies [UserAction, MetaTime][]
      }
    })
    reducer.type<UserAction>('users/create', action => {
      calls.push(action.id)
      return Promise.reject(new Error('The database was closed'))
    })

    await reducer.ready
    expect(calls).toEqual(['a'])
    expect(reducer.status.get()).toBe('ready')
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')
  })

  it('runs clean and init when version is higher than stored', async () => {
    let client = new TestClient('10')
    localStorage.setItem('logux:reducer:db', '1')

    let calls: string[] = []
    let migratings: Promise<void>[] = []
    let reducer = createReducer(client, 'db', 3, {
      clean(oldVersion) {
        calls.push(`clean:${oldVersion}`)
      },
      init() {
        calls.push('init')
      },
      migrating(done) {
        migratings.push(done)
      }
    })

    expect(reducer.status.get()).toBe('migrating')
    expect(migratings).toEqual([reducer.ready])
    await delay(1)
    expect(calls).toEqual(['clean:1', 'init'])
    expect(reducer.status.get()).toBe('ready')
    await reducer.ready
  })

  it('resolves ready promise on ready and on outdated', async () => {
    let client = new TestClient('10')
    let migratingCalled = 0
    let reducer = createReducer(client, 'db', 1, {
      clean() {},
      migrating() {
        migratingCalled += 1
      }
    })

    let resolved = false
    void reducer.ready.then(() => {
      resolved = true
    })
    expect(resolved).toBe(false)

    await reducer.ready
    expect(resolved).toBe(true)
    expect(reducer.status.get()).toBe('ready')
    expect(migratingCalled).toBe(0)

    emitStorage('logux:reducer:db', '2')
    expect(reducer.status.get()).toBe('outdated')
    await reducer.ready

    localStorage.setItem('logux:reducer:old', '5')
    let older = createReducer(client, 'old', 2, { clean() {} })
    expect(older.status.get()).toBe('outdated')
    await older.ready
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

    expect(reducer.status.get()).toBe('migrating')
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
    expect(reducer.status.get()).toBe('migrating')
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
    expect(reducer.status.get()).toBe('migrating')
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

  it('reduces the actions, which came before the lock was granted', async () => {
    mockLocks()

    let client = new TestClient('10')
    await client.connect()

    type UserAction = { id: string; type: 'users/create' }

    let reducer = createReducer(client, 'db', 1, { clean() {} })
    let received: string[] = []
    reducer.type<UserAction>('users/create', action => {
      received.push(action.id)
    })

    // The lock is granted in the next tick, so the action came before it
    await client.log.add({ id: '1', type: 'users/create' })
    expect(received).toEqual([])

    await delay(1)
    expect(received).toEqual(['1'])
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')
  })

  it('drops the actions when another tab is the leader', async () => {
    let locks = mockLocks()
    locks.hold(DB_LOCK)

    let client = new TestClient('10')
    await client.connect()

    type UserAction = { id: string; type: 'users/create' }

    let reducer = createReducer(client, 'db', 1, { clean() {} })
    let received: string[] = []
    reducer.type<UserAction>('users/create', action => {
      received.push(action.id)
    })

    await client.log.add({ id: '1', type: 'users/create' })
    await delay(1)
    await client.log.add({ id: '2', type: 'users/create' })
    await delay(1)

    expect(received).toEqual([])
    expect(locks.waiting(DB_LOCK)).toBe(1)
  })

  it('runs reducer only in leader tab and releases lock on new version', async () => {
    let locks = mockLocks()
    let releaseOtherTab = locks.hold(DB_LOCK)

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
    expect(locks.waiting(DB_LOCK)).toBe(1)

    releaseOtherTab()
    await delay(1)
    expect(locks.isHeld(DB_LOCK)).toBe(true)

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])

    emitStorage('logux:reducer:db', '2')
    await delay(1)
    expect(reducer.status.get()).toBe('outdated')
    expect(stopCalled).toBe(1)
    expect(locks.isHeld(DB_LOCK)).toBe(false)

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])
  })

  it('does not take the lock after the reducer became outdated', async () => {
    let locks = mockLocks()
    let releaseOtherTab = locks.hold(DB_LOCK)

    let client = new TestClient('10')
    await client.connect()

    let reducer = createReducer(client, 'db', 1, { clean() {} })
    let received: string[] = []
    reducer.type('users/create', action => {
      received.push(action.type)
    })

    await delay(1)
    expect(locks.waiting(DB_LOCK)).toBe(1)

    emitStorage('logux:reducer:db', '2')
    expect(reducer.status.get()).toBe('outdated')

    releaseOtherTab()
    await delay(1)
    expect(locks.isHeld(DB_LOCK)).toBe(false)

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual([])
  })

  it('stops reducing actions and storage tracking on destroy', async () => {
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

    await reducer.ready
    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])

    reducer.destroy()

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])

    emitStorage('logux:reducer:db', '2')
    expect(stopCalled).toBe(0)
    expect(reducer.status.get()).toBe('ready')
  })

  it('resolves ready on destroy and ignores second destroy', async () => {
    let client = new TestClient('10')

    let resolveInit: () => void = () => {}
    let reducer = createReducer(client, 'db', 1, {
      clean() {},
      init() {
        return new Promise<void>(resolve => {
          resolveInit = resolve
        })
      }
    })
    expect(reducer.status.get()).toBe('initializing')

    reducer.destroy()
    reducer.destroy()
    await reducer.ready

    resolveInit()
    await delay(1)
    expect(reducer.status.get()).toBe('initializing')
  })

  it('stops migration on destroy', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:db', '1')

    let calls: string[] = []
    let resolveClean!: (
      entries: [{ type: 'users/create' }, ClientMeta][]
    ) => void
    let reducer = createReducer(client, 'db', 2, {
      clean() {
        calls.push('clean')
        return new Promise<[{ type: 'users/create' }, ClientMeta][]>(
          resolve => {
            resolveClean = resolve
          }
        )
      },
      init() {
        calls.push('init')
      }
    })
    reducer.type('users/create', () => {
      calls.push('action')
    })

    await delay(1)
    expect(calls).toEqual(['clean'])

    reducer.destroy()
    resolveClean([
      [{ type: 'users/create' }, { id: 'a', time: 0, added: 0, reasons: [] }]
    ])
    await delay(1)
    expect(calls).toEqual(['clean'])
    expect(reducer.status.get()).toBe('migrating')
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')
  })

  it('stops replaying migration entries on destroy', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:db', '1')

    type UserAction = { id: string; type: 'users/create' }

    let calls: string[] = []
    let resolveListener: Record<string, () => void> = {}
    let reducer = createReducer(client, 'db', 2, {
      clean() {
        return [
          [
            { id: 'a', type: 'users/create' },
            { id: 'a', time: 0, added: 0, reasons: [] }
          ],
          [
            { id: 'b', type: 'users/create' },
            { id: 'b', time: 1, added: 0, reasons: [] }
          ]
        ] satisfies [UserAction, ClientMeta][]
      }
    })
    reducer.type<UserAction>('users/create', action => {
      calls.push(action.id)
      return new Promise<void>(resolve => {
        resolveListener[action.id] = resolve
      })
    })

    await delay(1)
    expect(calls).toEqual(['a'])

    reducer.destroy()
    resolveListener['a']!()
    await delay(1)
    expect(calls).toEqual(['a'])
    expect(reducer.status.get()).toBe('migrating')
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')
  })

  it('releases the lock on destroy', async () => {
    let locks = mockLocks()

    let client = new TestClient('10')
    await client.connect()

    let reducer = createReducer(client, 'db', 1, { clean() {} })
    let received: string[] = []
    reducer.type('users/create', action => {
      received.push(action.type)
    })

    await delay(1)
    expect(locks.isHeld(DB_LOCK)).toBe(true)

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])

    reducer.destroy()
    await delay(1)
    expect(locks.isHeld(DB_LOCK)).toBe(false)
  })

  it('cancels lock request on destroy in non-leader tab', async () => {
    let locks = mockLocks()
    let releaseOtherTab = locks.hold(DB_LOCK)

    let client = new TestClient('10')
    await client.connect()

    let reducer = createReducer(client, 'db', 1, { clean() {} })
    let received: string[] = []
    reducer.type('users/create', action => {
      received.push(action.type)
    })

    await delay(1)
    expect(locks.waiting(DB_LOCK)).toBe(1)
    expect(locks.aborted).toBe(0)

    reducer.destroy()
    await delay(1)
    expect(locks.waiting(DB_LOCK)).toBe(0)
    expect(locks.aborted).toBe(1)

    releaseOtherTab()
    let next = createReducer(client, 'db', 1, { clean() {} })
    next.type('users/create', action => {
      received.push(action.type)
    })
    await delay(1)
    expect(locks.isHeld(DB_LOCK)).toBe(true)

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])
  })

  it('removes the version on client clean', async () => {
    let client = new TestClient('10')
    await client.connect()

    let reducer = createReducer(client, 'db', 1, { clean() {} })
    await reducer.ready
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')

    await client.clean()
    expect(localStorage.getItem('logux:reducer:db')).toBeNull()
  })

  it('does not remove the version on client clean after destroy', async () => {
    let client = new TestClient('10')
    await client.connect()

    let reducer = createReducer(client, 'db', 1, { clean() {} })
    await reducer.ready
    reducer.destroy()

    await client.clean()
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')
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

  it('builds the value from repeat() on the first run', async () => {
    let client = new TestClient('10')
    await client.connect()

    let entries: [IncAction, ClientMeta][] = [
      [
        { amount: 2, type: 'inc' },
        { added: 0, id: 'a', reasons: [], time: 0 }
      ],
      [
        { amount: 3, type: 'inc' },
        { added: 0, id: 'b', reasons: [], time: 1 }
      ]
    ]

    let migratingCalled = 0
    let reducer = createStorageReducer(client, 'counter', 1, 0, {
      ...counterCallbacks(entries),
      migrating() {
        migratingCalled += 1
      }
    })
    reducer.type<IncAction>('inc', (prev, action) => prev + action.amount)

    // The value can be missed by the sync before the first start
    expect(reducer.status.get()).toBe('initializing')
    await reducer.ready
    expect(migratingCalled).toBe(0)
    expect(reducer.value.get()).toBe(5)
    expect(localStorage.getItem('counter')).toBe('5')
    expect(localStorage.getItem('logux:reducer:counter')).toBe('1')
  })

  it('repeats the actions on every start until the value will be built', async () => {
    let client = new TestClient('10')
    await client.connect()

    let repeats = 0
    let entries: [IncAction, ClientMeta][] = []

    let first = createStorageReducer(client, 'counter', 1, 0, {
      decode: s => parseInt(s, 10),
      encode: v => String(v),
      repeat() {
        repeats += 1
        return entries
      }
    })
    first.type<IncAction>('inc', (prev, action) => prev + action.amount)

    await first.ready
    expect(repeats).toBe(1)
    expect(first.value.get()).toBe(0)
    // The empty value must not hide the actions missed by the sync
    expect(localStorage.getItem('counter')).toBeNull()
    expect(localStorage.getItem('logux:reducer:counter')).toBeNull()
    first.destroy()

    entries = [
      [
        { amount: 4, type: 'inc' },
        { added: 0, id: 'a', reasons: [], time: 0 }
      ]
    ]
    let second = createStorageReducer(client, 'counter', 1, 0, {
      decode: s => parseInt(s, 10),
      encode: v => String(v),
      repeat() {
        repeats += 1
        return entries
      }
    })
    second.type<IncAction>('inc', (prev, action) => prev + action.amount)

    await second.ready
    expect(repeats).toBe(2)
    expect(second.value.get()).toBe(4)
    expect(localStorage.getItem('counter')).toBe('4')
    expect(localStorage.getItem('logux:reducer:counter')).toBe('1')
    second.destroy()

    // The value is in the storage now, so the actions are not repeated
    let third = createStorageReducer(client, 'counter', 1, 0, {
      decode: s => parseInt(s, 10),
      encode: v => String(v),
      repeat() {
        repeats += 1
        return entries
      }
    })
    third.type<IncAction>('inc', (prev, action) => prev + action.amount)

    await third.ready
    expect(repeats).toBe(2)
    expect(third.value.get()).toBe(4)
  })

  it('rebuilds the value when the version was stored without the value', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:counter', '1')

    let entries: [IncAction, ClientMeta][] = [
      [
        { amount: 7, type: 'inc' },
        { added: 0, id: 'a', reasons: [], time: 0 }
      ]
    ]

    let migratingCalled = 0
    let reducer = createStorageReducer(client, 'counter', 1, 0, {
      ...counterCallbacks(entries),
      migrating() {
        migratingCalled += 1
      }
    })
    reducer.type<IncAction>('inc', (prev, action) => prev + action.amount)

    await reducer.ready
    expect(migratingCalled).toBe(0)
    expect(reducer.value.get()).toBe(7)
    expect(localStorage.getItem('counter')).toBe('7')
  })

  it('replays actions restored from the data without reasons', async () => {
    let client = new TestClient('10')
    await client.connect()
    localStorage.setItem('logux:reducer:counter', '1')

    // Metas of actions restored by crdtTableToActions() have only ID and time
    let entries: [IncAction, MetaTime][] = [
      [
        { amount: 3, type: 'inc' },
        { id: 'a', time: 0 }
      ]
    ]

    let ids: string[] = []
    let reducer = createStorageReducer(client, 'counter', 2, 0, {
      decode: s => parseInt(s, 10),
      encode: v => String(v),
      repeat: () => entries
    })
    reducer.type<IncAction>('inc', (prev, action, meta) => {
      ids.push(meta.id)
      return prev + action.amount
    })

    await reducer.ready
    expect(ids).toEqual(['a'])
    expect(reducer.value.get()).toBe(3)
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

    let migratings: Promise<void>[] = []
    let reducer = createStorageReducer(client, 'counter', 2, 0, {
      ...counterCallbacks(entries),
      migrating(done) {
        migratings.push(done)
      }
    })
    reducer.type<IncAction>('inc', (prev, action) => prev + action.amount)

    expect(reducer.status.get()).toBe('migrating')
    expect(migratings).toEqual([reducer.ready])
    await reducer.ready
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

  it('does not save the value when the listener returns the same value', async () => {
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
    await delay(1)

    let changes: number[] = []
    reducer.value.listen(newValue => {
      changes.push(newValue)
    })

    await client.log.add({ amount: 0, type: 'inc' })
    await delay(1)
    expect(changes).toEqual([])
    expect(localStorage.getItem('counter')).toBeNull()

    await client.log.add({ amount: 2, type: 'inc' })
    await delay(1)
    expect(changes).toEqual([2])
    expect(localStorage.getItem('counter')).toBe('2')
  })

  it('uses value.eq to compare the value', async () => {
    let client = new TestClient('10')
    await client.connect()

    let encoded = 0
    let reducer = createStorageReducer<string[]>(client, 'ids', 1, [], {
      decode: str => str.split(','),
      encode(value) {
        encoded += 1
        return value.join(',')
      },
      repeat: () => []
    })
    reducer.value.eq = (prev, next) => prev?.join(',') === next.join(',')
    reducer.type<{ id: string; type: 'add' }>('add', (prev, action) => {
      return prev.includes(action.id) ? [...prev] : [...prev, action.id]
    })
    await delay(1)

    await client.log.add({ id: '1', type: 'add' })
    await delay(1)
    expect(reducer.value.get()).toEqual(['1'])
    expect(localStorage.getItem('ids')).toBe('1')
    expect(encoded).toBe(1)

    await client.log.add({ id: '1', type: 'add' })
    await delay(1)
    expect(reducer.value.get()).toEqual(['1'])
    expect(encoded).toBe(1)
  })

  it('stops reducing and syncing on destroy, but keeps the value', async () => {
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

    await client.log.add({ amount: 3, type: 'inc' })
    await delay(1)
    expect(reducer.value.get()).toBe(3)
    expect(localStorage.getItem('counter')).toBe('3')

    reducer.destroy()

    emitStorage('counter', '7')
    expect(reducer.value.get()).toBe(3)

    await client.log.add({ amount: 1, type: 'inc' })
    await delay(1)
    expect(reducer.value.get()).toBe(3)
    expect(localStorage.getItem('counter')).toBe('3')
  })

  it('removes the value and the version on client clean', async () => {
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

    await client.log.add({ amount: 3, type: 'inc' })
    await delay(1)
    expect(reducer.value.get()).toBe(3)
    expect(localStorage.getItem('counter')).toBe('3')
    expect(localStorage.getItem('logux:reducer:counter')).toBe('1')

    await client.clean()
    expect(reducer.value.get()).toBe(0)
    expect(localStorage.getItem('counter')).toBeNull()
    expect(localStorage.getItem('logux:reducer:counter')).toBeNull()
  })

  it('keeps the value on client clean after destroy', async () => {
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

    await client.log.add({ amount: 3, type: 'inc' })
    await delay(1)
    reducer.destroy()

    await client.clean()
    expect(reducer.value.get()).toBe(3)
    expect(localStorage.getItem('counter')).toBe('3')
    expect(localStorage.getItem('logux:reducer:counter')).toBe('1')
  })
})

describe('custom storage', () => {
  it('keeps the reducer version in custom storage', async () => {
    let client = new TestClient('10')
    await client.connect()
    let storage: PersistentStorage = {}

    let stopCalled = 0
    let reducer = createReducer(client, 'db', 1, {
      clean() {},
      stop() {
        stopCalled += 1
      },
      storage
    })
    let received: string[] = []
    reducer.type('users/create', action => {
      received.push(action.type)
    })

    await reducer.ready
    expect(reducer.status.get()).toBe('ready')
    expect(storage['logux:reducer:db']).toBe('1')
    expect(localStorage.getItem('logux:reducer:db')).toBeNull()

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])

    // Custom storage has no `storage` events
    emitStorage('logux:reducer:db', '2')
    expect(reducer.status.get()).toBe('ready')
    expect(stopCalled).toBe(0)
  })

  it('migrates the reducer by the version from custom storage', async () => {
    let client = new TestClient('10')
    await client.connect()
    let storage: PersistentStorage = { 'logux:reducer:db': '1' }

    let calls: string[] = []
    let reducer = createReducer(client, 'db', 2, {
      clean(oldVersion) {
        calls.push(`clean:${oldVersion}`)
      },
      init() {
        calls.push('init')
      },
      storage
    })

    await reducer.ready
    expect(calls).toEqual(['clean:1', 'init'])
    expect(reducer.status.get()).toBe('ready')
    expect(storage['logux:reducer:db']).toBe('2')
  })

  it('keeps the value in custom storage', async () => {
    let client = new TestClient('10')
    await client.connect()
    let storage: PersistentStorage = {
      'counter': '10',
      'logux:reducer:counter': '1'
    }

    let reducer = createStorageReducer(client, 'counter', 1, 0, {
      ...counterCallbacks(),
      storage
    })
    reducer.type<IncAction>('inc', (prev, action) => prev + action.amount)
    expect(reducer.value.get()).toBe(10)

    await reducer.ready
    expect(storage['logux:reducer:counter']).toBe('1')
    expect(localStorage.getItem('counter')).toBeNull()

    await client.log.add({ amount: 2, type: 'inc' })
    await delay(1)
    expect(reducer.value.get()).toBe(12)
    expect(storage.counter).toBe('12')

    // Custom storage has no `storage` events
    emitStorage('counter', '7')
    expect(reducer.value.get()).toBe(12)
  })

  it('tracks storage events when localStorage was passed explicitly', async () => {
    let client = new TestClient('10')
    await client.connect()

    let stopCalled = 0
    let reducer = createReducer(client, 'db', 1, {
      clean() {},
      stop() {
        stopCalled += 1
      },
      storage: localStorage
    })
    let value = createStorageReducer(client, 'counter', 1, 0, {
      ...counterCallbacks(),
      storage: localStorage
    })
    await reducer.ready
    expect(localStorage.getItem('logux:reducer:db')).toBe('1')

    emitStorage('counter', '7')
    expect(value.value.get()).toBe(7)

    emitStorage('logux:reducer:db', '2')
    expect(reducer.status.get()).toBe('outdated')
    expect(stopCalled).toBe(1)
  })

  it('cleans the value in custom storage on migration', async () => {
    let client = new TestClient('10')
    await client.connect()
    let storage: PersistentStorage = {
      'counter': '100',
      'logux:reducer:counter': '1'
    }
    let entries: [IncAction, ClientMeta][] = [
      [
        { amount: 4, type: 'inc' },
        { added: 0, id: 'a', reasons: [], time: 0 }
      ]
    ]

    let reducer = createStorageReducer(client, 'counter', 2, 0, {
      ...counterCallbacks(entries),
      storage
    })
    reducer.type<IncAction>('inc', (prev, action) => prev + action.amount)

    expect(reducer.status.get()).toBe('migrating')
    await reducer.ready
    expect(reducer.value.get()).toBe(4)
    expect(storage.counter).toBe('4')
  })

  it('cleans the value in custom storage on client clean', async () => {
    let client = new TestClient('10')
    await client.connect()
    let storage: PersistentStorage = {}

    let reducer = createStorageReducer(client, 'counter', 1, 0, {
      ...counterCallbacks(),
      storage
    })
    reducer.type<IncAction>('inc', (prev, action) => prev + action.amount)

    await client.log.add({ amount: 2, type: 'inc' })
    await delay(1)
    expect(storage.counter).toBe('2')
    expect(storage['logux:reducer:counter']).toBe('1')

    await client.clean()
    expect(reducer.value.get()).toBe(0)
    expect(storage.counter).toBeUndefined()
    expect(storage['logux:reducer:counter']).toBeUndefined()
  })
})

describe('without localStorage', () => {
  beforeEach(() => {
    // @ts-expect-error Emulate server-side rendering
    window.localStorage = undefined
  })

  it('reduces actions without localStorage', async () => {
    let client = new TestClient('10')
    await client.connect()

    let calls: string[] = []
    let reducer = createReducer(client, 'db', 1, {
      clean() {
        calls.push('clean')
      },
      init() {
        calls.push('init')
      }
    })
    let received: string[] = []
    reducer.type('users/create', action => {
      received.push(action.type)
    })

    await reducer.ready
    expect(reducer.status.get()).toBe('ready')
    // The version is kept in memory only, so the data is built
    // from the repeated actions on every start
    expect(calls).toEqual(['clean', 'init'])

    await client.log.add({ type: 'users/create' })
    await delay(1)
    expect(received).toEqual(['users/create'])
  })

  it('keeps the value in memory without localStorage', async () => {
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

    await reducer.ready
    expect(reducer.value.get()).toBe(0)

    await client.log.add({ amount: 2, type: 'inc' })
    await delay(1)
    expect(reducer.value.get()).toBe(2)
  })
})
