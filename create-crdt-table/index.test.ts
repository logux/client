import { defineAction } from '@logux/actions'
import {
  type Action,
  type AnyAction,
  toSorted,
  type MetaTime
} from '@logux/core'
import type {
  Database,
  Driver,
  DriverTransaction,
  SqlParam,
  SqlStore
} from '@nanostores/sql'
import { openDb } from '@nanostores/sql'
import { nodeDriver } from '@nanostores/sql/node'
import { delay } from 'nanodelay'
import { cleanStores } from 'nanostores'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import {
  Client,
  type ClientMeta,
  loadValue,
  SqlLogStore,
  TestClient
} from '../index.js'
import { setLocalStorage } from '../test/local-storage.js'
import {
  bigint,
  boolean,
  type CrdtCell,
  type CrdtCorruption,
  type CrdtTable,
  type CrdtTableRow,
  createCrdtDatabase,
  createCrdtTasks,
  crdtTableToActions,
  number,
  oneOf,
  optional,
  parseCrdtAction,
  parseCrdtRows,
  parseCrdtType,
  string,
  withMeta,
  withoutMeta
} from './index.js'

let unloaders: ((event: { returnValue: string }) => string)[] = []

function restored(meta: ClientMeta): MetaTime {
  return { id: meta.id, time: meta.time }
}

beforeAll(() => {
  setLocalStorage()

  let originAdd = window.addEventListener.bind(window)
  let originRemove = window.removeEventListener.bind(window)
  window.addEventListener = (event: string, cb: any, ...args: any[]) => {
    if (event === 'beforeunload') unloaders.push(cb)
    originAdd(event as any, cb, ...args)
  }
  window.removeEventListener = (event: string, cb: any, ...args: any[]) => {
    if (event === 'beforeunload') unloaders = unloaders.filter(i => i !== cb)
    originRemove(event as any, cb, ...args)
  }
})

beforeEach(() => {
  localStorage.clear()
  unloaders = []
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

function manualLocks(): {
  grant: () => Promise<void>
  names: string[]
} {
  let waiting: (() => Promise<unknown>)[] = []
  let names: string[] = []
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request(
        name: string,
        opts: { signal?: AbortSignal },
        callback: () => Promise<unknown>
      ) {
        names.push(name)
        return new Promise((resolve, reject) => {
          waiting.push(() => {
            // Browser doesn’t call the callback of the aborted request
            if (opts.signal?.aborted) return Promise.resolve()
            return Promise.resolve(callback()).then(resolve)
          })
          opts.signal?.addEventListener('abort', () => {
            reject(new Error('AbortError'))
          })
        })
      }
    }
  })
  return {
    async grant() {
      let next = waiting.shift()
      // The lock can be kept after the write, so we wait only for the grant,
      // not for the callback’s promise
      if (next) {
        void next()
        await delay(10)
      }
    },
    names
  }
}

/**
 * Locks are granted in the request order, like in real browsers.
 */
function queuedLocks(): void {
  let tails: Record<string, Promise<void>> = {}
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request(
        name: string,
        opts: { signal?: AbortSignal },
        callback: () => Promise<unknown>
      ) {
        let previous = tails[name] ?? Promise.resolve()
        let free: (waiting?: PromiseLike<void> | void) => void = () => {}
        tails[name] = new Promise<void>(resolve => {
          free = resolve
        })
        return new Promise<void>((granted, aborted) => {
          void previous.then(granted)
          opts.signal?.addEventListener('abort', () => {
            aborted(new Error('AbortError'))
          })
        }).then(
          () =>
            Promise.resolve(callback()).then(() => {
              free()
            }),
          error => {
            free(previous)
            throw error
          }
        )
      }
    }
  })
}

const USER_SCHEMA = {
  age: optional(number()),
  createdAt: bigint({ default: () => new Date(2026, 0, 1).getTime() }),
  isAdmin: number({ default: 0 }),
  name: string(),
  publishedAt: optional(bigint()),
  role: oneOf(['admin', 'guest', 'user'], { default: 'user' })
}

type UserValue = CrdtTableRow<typeof USER_SCHEMA>

async function setup(): Promise<{
  client: TestClient
  db: Database
}> {
  let client = new TestClient('10')
  await client.connect()
  let db = openDb(nodeDriver(':memory:'))
  return { client, db }
}

async function loadList<Row>(store: SqlStore<Row[]>): Promise<Row[]> {
  let value = await loadValue(store)
  return value.value
}

async function tableNames(db: Database): Promise<string[]> {
  let rows = (await db.driver.select(
    'SELECT "name" FROM "sqlite_master" WHERE "type" = ? ORDER BY "name"',
    ['table']
  )) as { name: string }[]
  return rows.map(i => i.name)
}

/**
 * Wrap `exec()` of the driver and of its transactions, since the schema
 * is created inside a transaction.
 */
function hookExec(
  origin: Driver,
  hook: (query: string, exec: () => Promise<unknown>) => Promise<unknown>
): Driver {
  return {
    ...origin,
    exec(query: string, params: SqlParam[]) {
      return hook(query, () => origin.exec(query, params))
    },
    transaction(callback, opts) {
      return origin.transaction(
        tx =>
          callback({
            ...tx,
            exec(query: string, params: SqlParam[]) {
              return hook(query, () => tx.exec(query, params))
            }
          }),
        opts
      )
    }
  }
}

function brokenDriver(error: Error, wait = 0): Driver {
  let driver: Driver = {
    close() {},
    async exec() {
      if (wait) await delay(wait)
      throw error
    },
    select() {
      return Promise.resolve([])
    },
    subscribe() {
      return () => {}
    },
    transaction(callback) {
      return callback(driver)
    }
  }
  return driver
}

function hangingDriver(): Driver {
  let driver: Driver = {
    close() {},
    exec() {
      return new Promise(() => {})
    },
    select() {
      return new Promise(() => {})
    },
    subscribe() {
      return () => {}
    },
    transaction(callback) {
      return callback(driver)
    }
  }
  return driver
}

async function indexSqls(db: Database): Promise<string[]> {
  let rows = (await db.driver.select(
    'SELECT "sql" FROM "sqlite_master"' +
      ' WHERE "type" = ? AND "sql" IS NOT NULL ORDER BY "name"',
    ['index']
  )) as { sql: string }[]
  return rows.map(i => i.sql)
}

it('creates tables and applies create, update and delete actions', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)

  expect(crdt.status.get()).toBe('initializing')
  await delay(10)
  expect(crdt.status.get()).toBe('ready')

  let id = await user.create({ name: 'Ann' })
  await delay(10)

  let $all = user.select()
  let rows = await loadList($all)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.id).toBe(id)
  expect(rows[0]!.name).toBe('Ann')
  expect(rows[0]!.age).toBeNull()
  expect(rows[0]!.isAdmin).toBe(0)
  expect(rows[0]!.role).toBe('user')
  expect(rows[0]!.createdAt).toBe(new Date(2026, 0, 1).getTime())
  expect(rows[0]!.publishedAt).toBeNull()
  expect(rows[0]!.updatedAt_name).toBeTypeOf('string')
  expect(rows[0]!.updatedAt_age).toBeNull()

  await user.update(id, { age: 30, isAdmin: 1 })
  await delay(10)
  let updated = await loadList($all)
  expect(updated[0]!.age).toBe(30)
  expect(updated[0]!.isAdmin).toBe(1)
  expect(updated[0]!.name).toBe('Ann')
  expect(updated[0]!.updatedAt_age).toBeTypeOf('string')

  await user.update(id, { age: null, name: undefined })
  await delay(10)
  expect((await loadList($all))[0]!.age).toBeNull()
  expect((await loadList($all))[0]!.name).toBe('Ann')

  await user.delete(id)
  await delay(10)
  expect(await loadList($all)).toEqual([])

  cleanStores($all)
})

it('creates, updates and deletes many rows by batch actions', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  let ids = await user.create([
    { name: 'Ann' },
    { id: 'U2', isAdmin: 1, name: 'Ben' },
    { age: 20, name: 'Cat' }
  ])
  expect(ids).toHaveLength(3)
  expect(ids[1]).toBe('U2')
  await delay(10)

  let $all = user.select`ORDER BY "name"`
  let rows = await loadList($all)
  expect(rows.map(i => i.name)).toEqual(['Ann', 'Ben', 'Cat'])
  expect(rows.map(i => i.id)).toEqual(ids)
  expect(rows.map(i => i.isAdmin)).toEqual([0, 1, 0])
  expect(rows.map(i => i.age)).toEqual([null, null, 20])
  expect(rows.map(i => i.role)).toEqual(['user', 'user', 'user'])
  expect(rows[0]!.updatedAt_name).toBe(rows[2]!.updatedAt_name)

  await user.update([ids[0]!, 'U2'], { isAdmin: 1, role: 'admin' })
  await delay(10)
  let updated = await loadList($all)
  expect(updated.map(i => i.isAdmin)).toEqual([1, 1, 0])
  expect(updated.map(i => i.role)).toEqual(['admin', 'admin', 'user'])
  expect(updated[0]!.name).toBe('Ann')

  await user.delete([ids[0]!, 'U2'])
  await delay(10)
  expect((await loadList($all)).map(i => i.name)).toEqual(['Cat'])

  cleanStores($all)
})

it('takes null in create() as a missing field', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  let id = ''
  let sent = await client.sent(async () => {
    id = await user.create({ age: null, name: 'Ann', publishedAt: null })
    await delay(10)
  })

  expect(sent).toEqual([
    {
      fields: {
        createdAt: new Date(2026, 0, 1).getTime(),
        isAdmin: 0,
        name: 'Ann',
        role: 'user'
      },
      id,
      type: 'user/created'
    }
  ])

  let $all = user.select`ORDER BY "name"`
  let rows = await loadList($all)
  expect(rows[0]!.age).toBeNull()
  expect(rows[0]!.publishedAt).toBeNull()
  expect(rows[0]!.updatedAt_age).toBeNull()
  expect(rows[0]!.updatedAt_publishedAt).toBeNull()
  expect(rows[0]!.createdAt).toBe(new Date(2026, 0, 1).getTime())
  expect(rows[0]!.isAdmin).toBe(0)
  expect(rows[0]!.role).toBe('user')

  cleanStores($all)
})

it('creates rows again from selected rows', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  await user.create([
    { id: 'U1', name: 'Ann' },
    { age: 20, id: 'U2', name: 'Ben', publishedAt: 100 }
  ])
  await delay(10)

  let $all = user.select`ORDER BY "name"`
  let backup = withoutMeta(await loadList($all))
  await user.delete(['U1', 'U2'])
  await delay(10)
  expect(await loadList($all)).toEqual([])

  await user.create(backup)
  await delay(10)
  expect(withoutMeta(await loadList($all))).toEqual(backup)

  let copies = await user.create(backup.map(row => ({ ...row, id: undefined })))
  await delay(10)
  expect((await loadList($all)).map(i => i.name)).toEqual([
    'Ann',
    'Ann',
    'Ben',
    'Ben'
  ])

  let $copies = user.select`
    WHERE "id" IN (${copies[0]!}, ${copies[1]!}) ORDER BY "name"
  `
  let rows = await loadList($copies)
  expect(withoutMeta(rows).map(row => ({ ...row, id: 'ID' }))).toEqual(
    backup.map(row => ({ ...row, id: 'ID' }))
  )
  expect(rows[0]!.updatedAt_age).toBeNull()
  expect(rows[1]!.updatedAt_age).toBeTypeOf('string')

  cleanStores($all, $copies)
})

it('resolves conflicts of batch actions with per-field last write wins', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  await client.log.add(
    {
      records: [
        { id: 'U1', name: 'Ann' },
        { id: 'U2', name: 'Ben', role: 'admin' }
      ],
      type: 'user/created'
    },
    { id: 'm 10:other', time: 50 }
  )
  await delay(10)

  await client.log.add(
    { fields: { name: 'Older' }, ids: ['U1', 'U2'], type: 'user/changed' },
    { id: '9 10:other', time: 10 }
  )
  await client.log.add(
    {
      fields: { age: 30, name: 'Newer' },
      ids: ['U1', 'U2', 'U3'],
      type: 'user/changed'
    },
    { id: '0Z 10:other', time: 100 }
  )
  await delay(10)

  let rows = await loadList(user.select`ORDER BY "id"`)
  expect(rows.map(i => i.id)).toEqual(['U1', 'U2'])
  expect(rows.map(i => i.name)).toEqual(['Newer', 'Newer'])
  expect(rows.map(i => i.age)).toEqual([30, 30])
  expect(rows.map(i => i.role)).toEqual([null, 'admin'])
  expect(rows[0]!.updatedAt_name).toBe(
    toSorted({ id: '0Z 10:other', time: 100 })
  )

  await client.log.add(
    {
      records: [
        { id: 'U1', name: 'Recreated' },
        { id: 'U3', name: 'Cat' }
      ],
      type: 'user/created'
    },
    { id: '27 10:other', time: 200 }
  )
  await delay(10)
  let mixed = await loadList(user.select`ORDER BY "id"`)
  expect(mixed.map(i => i.id)).toEqual(['U1', 'U2', 'U3'])
  expect(mixed.map(i => i.name)).toEqual(['Recreated', 'Newer', 'Cat'])
  expect(mixed[0]!.age).toBe(30)
})

it('applies batch actions in the smallest number of queries', async () => {
  let { client, db } = await setup()
  let executed: string[] = []
  let origin = db.driver.exec.bind(db.driver)
  db.driver.exec = (sql, params) => {
    executed.push(sql)
    return origin(sql, params)
  }
  let transactions = 0
  let originTransaction = db.driver.transaction.bind(db.driver)
  db.driver.transaction = callback => {
    transactions += 1
    return originTransaction(tx => {
      let originTxExec = tx.exec.bind(tx)
      tx.exec = (sql, params) => {
        executed.push(sql)
        return originTxExec(sql, params)
      }
      return callback(tx)
    })
  }

  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)
  executed = []
  transactions = 0

  await user.create([
    { id: 'U1', name: 'Ann' },
    { id: 'U2', name: 'Ben' },
    { age: 20, id: 'U3', name: 'Cat' }
  ])
  await delay(10)
  expect(executed).toEqual([
    'INSERT INTO "user" ("id", "name", "createdAt", "isAdmin", "role", "age",' +
      ' "updatedAt_name", "updatedAt_createdAt", "updatedAt_isAdmin",' +
      ' "updatedAt_role", "updatedAt_age")' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),' +
      ' (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ])
  expect(transactions).toBe(1)

  // Rows have different history now: U1’s name and U3’s age were changed
  // by other actions, so all three rows have different fields meta
  executed = []
  await user.update('U1', { name: 'Anna' })
  await delay(10)
  expect(executed).toEqual([
    'UPDATE "user" SET "name" = ?, "updatedAt_name" = ? WHERE "id" IN (?)'
  ])

  executed = []
  await user.update(['U1', 'U2', 'U3'], { isAdmin: 1 })
  await delay(10)
  expect(executed).toEqual([
    'UPDATE "user" SET "isAdmin" = ?, "updatedAt_isAdmin" = ?' +
      ' WHERE "id" IN (?, ?, ?)'
  ])
  expect(transactions).toBe(3)

  executed = []
  await user.delete(['U1', 'U2'])
  await delay(10)
  expect(executed).toEqual(['DELETE FROM "user" WHERE "id" IN (?, ?)'])
  expect(transactions).toBe(4)

  expect((await loadList(user.select())).map(i => i.id)).toEqual(['U3'])
})

it('ignores empty batch actions', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  let ids = await user.create([])
  expect(ids).toEqual([])
  await user.update([], { name: 'Ann' })
  await user.delete([])
  await delay(10)

  expect(await loadList(user.select())).toEqual([])
  expect(client.log.entries()).toEqual([])
})

it('passes raw select params to the driver', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  let id = await user.create({
    id: 'ID1',
    isAdmin: 1,
    name: 'Ben',
    publishedAt: 1000,
    role: 'admin'
  })
  expect(id).toBe('ID1')
  let id2 = await user.create({ name: 'Ann', publishedAt: 3000 })
  await delay(10)

  let $admins = user.select`WHERE "isAdmin" = ${1} ORDER BY "name"`
  let admins = await loadList($admins)
  expect(admins.map(i => i.id)).toEqual(['ID1'])
  expect(admins[0]!.publishedAt).toBe(1000)
  expect(admins[0]!.role).toBe('admin')

  let $late = user.select`WHERE "publishedAt" > ${2000}`
  expect((await loadList($late)).map(i => i.name)).toEqual(['Ann'])

  let $named = user.select`WHERE "name" = ${'Ann'}`
  expect((await loadList($named)).map(i => i.id)).toEqual([id2])
})

it('resolves conflicts with per-field last write wins', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  await client.log.add(
    {
      fields: { name: 'Oldest', role: 'admin' },
      id: 'U1',
      type: 'user/created'
    },
    { id: '9 10:other', time: 10 }
  )
  await delay(10)

  await client.log.add(
    { fields: { name: 'New' }, id: 'U1', type: 'user/changed' },
    { id: '0Z 10:other', time: 100 }
  )
  await delay(10)

  await client.log.add(
    { fields: { age: 20, name: 'Old' }, id: 'U1', type: 'user/changed' },
    { id: 'm 10:other', time: 50 }
  )
  await delay(10)

  let rows = await loadList(user.select())
  expect(rows).toHaveLength(1)
  expect(rows[0]!.name).toBe('New')
  expect(rows[0]!.age).toBe(20)
  expect(rows[0]!.role).toBe('admin')
  expect(rows[0]!.updatedAt_name).toBe(
    toSorted({ id: '0Z 10:other', time: 100 })
  )
  expect(rows[0]!.updatedAt_age).toBe(toSorted({ id: 'm 10:other', time: 50 }))

  await client.log.add(
    { fields: { name: 'New' }, id: 'U1', type: 'user/changed' },
    { id: '0Z 10:other', time: 100 }
  )
  await delay(10)
  let same = await loadList(user.select())
  expect(same[0]!.name).toBe('New')
  expect(same[0]!.updatedAt_name).toBe(
    toSorted({ id: '0Z 10:other', time: 100 })
  )
})

it('ignores changes of deleted rows', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  let id = await user.create({ name: 'Ann' })
  await delay(10)
  await user.delete(id)
  await delay(10)

  await client.log.add(
    { fields: { name: 'New' }, id, type: 'user/changed' },
    { id: '27 10:other', time: 200 }
  )
  await delay(10)

  expect(await loadList(user.select())).toEqual([])
})

it('fills table from existing log on first run', async () => {
  let { client, db } = await setup()
  await client.log.add(
    { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
    { reasons: ['test'] }
  )
  await client.log.add(
    { fields: { name: 'Ben' }, id: 'U2', type: 'user/created' },
    { reasons: ['test'] }
  )
  await client.log.add(
    { id: 'U2', type: 'user/deleted' },
    { reasons: ['test'] }
  )
  await client.log.add({ type: 'other' }, { reasons: ['test'] })

  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  expect(crdt.status.get()).toBe('initializing')
  await delay(10)
  expect(crdt.status.get()).toBe('ready')

  let rows = await loadList(user.select())
  expect(rows.map(i => i.id)).toEqual(['U1'])
  expect(localStorage.getItem('logux:db')).toBeTypeOf('string')
})

it('rebuilds database on schema change and replays repeat() entries', async () => {
  let { client, db } = await setup()
  localStorage.setItem(
    'logux:db',
    JSON.stringify({ tables: { removed: {}, user: {} } })
  )
  await db.driver.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY)', [])
  await db.driver.exec('INSERT INTO "user" ("id") VALUES (?)', ['garbage'])
  await db.driver.exec('CREATE TABLE "removed" ("id" TEXT PRIMARY KEY)', [])

  await client.log.add(
    { fields: { name: 'FromLog' }, id: 'U1', type: 'user/created' },
    { reasons: ['test'] }
  )
  type CreatedAction = {
    fields: { name: string }
    id: string
    type: 'user/created'
  } & Action
  let entries: [CreatedAction, ClientMeta][] = [
    [
      { fields: { name: 'FromRepeat' }, id: 'U2', type: 'user/created' },
      { added: 0, id: '9 10:other', reasons: [], time: 10 }
    ]
  ]

  let migratings: Promise<void>[] = []
  let oldRows: unknown
  let crdt = createCrdtDatabase(client, db, {
    async repeat() {
      oldRows = await db.driver.select('SELECT "id" FROM "user"', [])
      return entries
    }
  })
  crdt.on('migrating', done => {
    migratings.push(done)
  })
  let user = crdt.table('user', USER_SCHEMA)
  let statuses: string[] = []
  crdt.status.subscribe(state => {
    statuses.push(state)
  })
  await delay(10)
  expect(statuses).toEqual(['initializing', 'migrating', 'ready'])
  expect(migratings).toEqual([crdt.ready])
  expect(oldRows).toEqual([{ id: 'garbage' }])
  await crdt.ready

  let rows = await loadList(user.select`ORDER BY "id"`)
  expect(rows.map(i => i.id)).toEqual(['U1', 'U2'])
  expect(rows.map(i => i.name)).toEqual(['FromLog', 'FromRepeat'])
  expect(localStorage.getItem('logux:db')).toContain('"user":')

  let leftover = await db.driver.select(
    'SELECT "name" FROM "sqlite_master" WHERE "type" = ? AND "name" = ?',
    ['table', 'removed']
  )
  expect(leftover).toEqual([])
})

it('rebuilds database on schema change without repeat()', async () => {
  let { client, db } = await setup()
  localStorage.setItem('logux:db', '{}')

  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  let statuses: string[] = []
  crdt.status.subscribe(state => {
    statuses.push(state)
  })
  await delay(10)
  expect(statuses).toEqual(['initializing', 'migrating', 'ready'])
  expect(await loadList(user.select())).toEqual([])
})

it('restores actions from tables', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  let post = crdt.table('post', { title: string() })
  let empty = crdt.table('empty', { title: string() })
  await crdt.ready

  let metas: ClientMeta[] = []
  client.on('add', (action, meta) => {
    if (/^(user|post)\//.test(action.type)) metas.push(meta)
  })

  await user.create([
    { id: 'U1', name: 'Ann' },
    { id: 'U2', name: 'Ben' }
  ])
  await user.create({ age: 30, id: 'U3', name: 'Jim' })
  await user.update(['U1', 'U2'], { role: 'admin' })
  await user.update('U3', { publishedAt: null })
  await post.create({ id: 'P1', title: 'Hello' })

  let createdAt = new Date(2026, 0, 1).getTime()
  expect(await crdtTableToActions([user, post, empty])).toEqual([
    [
      {
        // The role cells were overwritten by the changed action below,
        // so the restored created action does not have them
        records: [
          { createdAt, id: 'U1', isAdmin: 0, name: 'Ann' },
          { createdAt, id: 'U2', isAdmin: 0, name: 'Ben' }
        ],
        type: 'user/created'
      },
      restored(metas[0]!)
    ],
    [
      {
        fields: { age: 30, createdAt, isAdmin: 0, name: 'Jim', role: 'user' },
        id: 'U3',
        type: 'user/created'
      },
      restored(metas[1]!)
    ],
    [
      { fields: { role: 'admin' }, ids: ['U1', 'U2'], type: 'user/changed' },
      restored(metas[2]!)
    ],
    [
      { fields: { publishedAt: null }, id: 'U3', type: 'user/changed' },
      restored(metas[3]!)
    ],
    [
      { fields: { title: 'Hello' }, id: 'P1', type: 'post/created' },
      restored(metas[4]!)
    ]
  ])
})

it('replays restored actions into the same tables', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  await user.create([
    { id: 'U1', name: 'Ann' },
    { id: 'U2', name: 'Ben' }
  ])
  await user.update(['U1', 'U2'], { name: 'Renamed' })
  await user.update('U2', { age: 30, isAdmin: 1, role: 'admin' })
  await user.update('U2', { createdAt: 200 })

  let entries = await crdtTableToActions([user])
  // U2 kept no cells of its created action, so its oldest left action
  // is the rename: it is restored as created and the replay applies it
  // to the already created U1 as a change
  expect(entries.map(i => i[0].type)).toEqual([
    'user/created',
    'user/created',
    'user/changed',
    'user/changed'
  ])
  expect(entries[1]![0]).toEqual({
    records: [
      { id: 'U1', name: 'Renamed' },
      { id: 'U2', name: 'Renamed' }
    ],
    type: 'user/created'
  })

  let rows = await db.driver.select('SELECT * FROM "user" ORDER BY "id"', [])

  let client2 = new TestClient('10')
  await client2.connect()
  for (let [action, meta] of entries) {
    await client2.log.add(action, {
      id: meta.id,
      reasons: ['test'],
      time: meta.time
    })
  }
  let db2 = openDb(nodeDriver(':memory:'))
  let crdt2 = createCrdtDatabase(client2, db2, { key: 'logux:db2' })
  crdt2.table('user', USER_SCHEMA)
  await crdt2.ready

  expect(
    await db2.driver.select('SELECT * FROM "user" ORDER BY "id"', [])
  ).toEqual(rows)
})

it('reports won cells to applied listeners', async () => {
  let { client, db } = await setup()
  let applied: [string, string, [string, string, string][]][] = []
  let crdt = createCrdtDatabase(client, db)
  crdt.on('applied', async (tx, action, meta, won) => {
    // The hook can use the applying transaction
    await tx.driver.select('SELECT 1', [])
    applied.push([action.type, meta.id, won])
  })
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  let metas: ClientMeta[] = []
  client.on('add', (action, meta) => {
    metas.push(meta)
  })

  await user.create({ id: 'U1', name: 'Ann' })
  await user.create({ id: 'U2', name: 'Ben' })
  await user.update(['U1', 'U2'], { role: 'admin' })
  await user.delete('U2')
  // The change is older than every cell of U1, so it wins nothing
  await client.log.add(
    { fields: { name: 'Old' }, id: 'U1', type: 'user/changed' },
    { id: '0 10:other', reasons: ['test'], time: 0 }
  )
  await delay(10)

  let createdAt = new Date(2026, 0, 1).getTime()
  expect(applied).toEqual([
    [
      'user/created',
      metas[0]!.id,
      [
        ['user', 'U1', 'name'],
        ['user', 'U1', 'createdAt'],
        ['user', 'U1', 'isAdmin'],
        ['user', 'U1', 'role']
      ]
    ],
    [
      'user/created',
      metas[1]!.id,
      [
        ['user', 'U2', 'name'],
        ['user', 'U2', 'createdAt'],
        ['user', 'U2', 'isAdmin'],
        ['user', 'U2', 'role']
      ]
    ],
    [
      'user/changed',
      metas[2]!.id,
      [
        ['user', 'U1', 'role'],
        ['user', 'U2', 'role']
      ]
    ],
    ['user/deleted', metas[3]!.id, []],
    ['user/changed', '0 10:other', []]
  ])
  expect(withoutMeta(await loadList(user.select()))[0]).toMatchObject({
    createdAt,
    name: 'Ann'
  })
})

it('returns won cells from change() without applied event', async () => {
  let { client, db } = await setup()
  let applied: string[] = []
  let crdt = createCrdtDatabase(client, db)
  crdt.on('applied', (tx, action) => {
    applied.push(action.type)
  })
  let user = crdt.table('user', USER_SCHEMA)
  let renamed = defineAction<{ name: string; type: 'renamed' }>('renamed')
  let won: unknown
  let rename = crdt.action(renamed, async (tx, action, meta) => {
    won = await user.change(tx, 'U1', { name: action.name }, meta)
  })
  await crdt.ready

  await user.create({ id: 'U1', name: 'Ann' })
  await rename({ name: 'New' })

  expect(won).toEqual([['user', 'U1', 'name']])
  expect(applied).toEqual(['user/created'])
})

it('reports touched cells to applied listeners', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  let cells: [string, CrdtCell[], CrdtCell[]][] = []
  crdt.on('applied', (tx, action, meta, won, touched) => {
    cells.push([action.type, won, touched])
  })

  await client.log.add(
    { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
    { reasons: ['test'] }
  )
  await user.update('U1', { age: 30 })
  // The change is older than the name cell, so it wins nothing
  await client.log.add(
    { fields: { name: 'Old' }, id: 'U1', type: 'user/changed' },
    { id: '0 10:other', reasons: ['test'], time: 0 }
  )
  await client.log.add(
    { fields: { name: 'Ben' }, ids: ['U1', 'U404'], type: 'user/changed' },
    { reasons: ['test'] }
  )
  await user.delete('U1')
  await delay(10)

  expect(cells).toEqual([
    ['user/created', [['user', 'U1', 'name']], [['user', 'U1', 'name']]],
    ['user/changed', [['user', 'U1', 'age']], [['user', 'U1', 'age']]],
    ['user/changed', [], [['user', 'U1', 'name']]],
    [
      'user/changed',
      [['user', 'U1', 'name']],
      [
        ['user', 'U1', 'name'],
        ['user', 'U404', 'name']
      ]
    ],
    ['user/deleted', [], []]
  ])
})

it('supports many applied listeners', async () => {
  let { client, db } = await setup()
  let calls: string[] = []
  let crdt = createCrdtDatabase(client, db)
  crdt.on('applied', async (tx, action) => {
    await delay(1)
    calls.push(`first ${action.type}`)
  })
  let user = crdt.table('user', USER_SCHEMA)
  let unbind = crdt.on('applied', async (tx, action) => {
    // Listeners share the applying transaction, so they are called one by one
    await tx.driver.select('SELECT 1', [])
    calls.push(`second ${action.type}`)
  })
  crdt.on('applied', (tx, action) => {
    calls.push(`third ${action.type}`)
  })
  await crdt.ready

  await user.create({ id: 'U1', name: 'Ann' })
  expect(calls).toEqual([
    'first user/created',
    'second user/created',
    'third user/created'
  ])

  unbind()
  calls = []
  await user.update('U1', { name: 'Ben' })
  expect(calls).toEqual(['first user/changed', 'third user/changed'])
})

it('sends the database error to corrupted listeners', async () => {
  let client = new TestClient('10')
  await client.connect()
  let error = new Error('No disk space')

  let unhandled: unknown[] = []
  let origin = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', reason => {
    unhandled.push(reason)
  })

  let errors: string[] = []
  let crdt = createCrdtDatabase(client, openDb(brokenDriver(error)))
  crdt.on('corrupted', (reason, e) => {
    errors.push(`first ${reason} ${(e as Error).message}`)
  })
  crdt.table('user', USER_SCHEMA)
  crdt.on('corrupted', (reason, e) => {
    errors.push(`second ${reason} ${(e as Error).message}`)
  })

  await crdt.ready
  await delay(10)

  process.removeAllListeners('unhandledRejection')
  for (let listener of origin) process.on('unhandledRejection', listener)

  expect(errors).toEqual([
    'first error No disk space',
    'second error No disk space'
  ])
  expect(unhandled).toEqual([])
})

it('sends the migration to migrating listeners', async () => {
  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  crdt1.table('user', USER_SCHEMA)
  await crdt1.ready
  crdt1.destroy()

  let events: string[] = []
  let crdt2 = createCrdtDatabase(client, db)
  crdt2.on('migrating', done => {
    events.push('first')
    void done.then(() => {
      events.push('first done')
    })
  })
  crdt2.table('user', USER_SCHEMA, ['name'])
  crdt2.on('migrating', done => {
    events.push('second')
    void done.then(() => {
      events.push('second done')
    })
  })

  await crdt2.ready
  await delay(10)
  expect(events).toEqual(['first', 'second', 'first done', 'second done'])
})

it('sends the newer schema in another tab to stop listeners', async () => {
  let { client, db } = await setup()
  let stopped: string[] = []
  let crdt = createCrdtDatabase(client, db)
  crdt.on('stop', () => {
    stopped.push('first')
  })
  crdt.table('user', USER_SCHEMA)
  let unbind = crdt.on('stop', () => {
    stopped.push('second')
  })
  await crdt.ready

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('outdated')
  expect(stopped).toEqual(['first', 'second'])

  unbind()
})

/**
 * Table actions have extra keys, which `Action` does not allow in a literal.
 */
function tableAction(action: AnyAction): Action {
  return action
}

it('parses the type of table actions', () => {
  let tables = { user: USER_SCHEMA }

  expect(parseCrdtType('user/created', tables)).toEqual({
    plural: 'user',
    verb: 'created'
  })
  expect(parseCrdtType('user/deleted', tables)).toEqual({
    plural: 'user',
    verb: 'deleted'
  })
  expect(parseCrdtType('user/renamed', tables)).toBe(false)
  expect(parseCrdtType('post/created', tables)).toBe(false)
  expect(parseCrdtType('rename', tables)).toBe(false)
})

it('parses the rows of table actions without the schema', () => {
  // The fields are the action’s own values: the caller filters them
  // by the schema, since the row of a `records` action also has `id`
  expect(
    parseCrdtRows(
      tableAction({
        records: [{ id: 'U1', name: 'Ann', unknown: 1 }],
        type: 'user/created'
      })
    )
  ).toEqual([['U1', { id: 'U1', name: 'Ann', unknown: 1 }]])

  expect(
    parseCrdtRows(
      tableAction({
        fields: { name: 'Ann' },
        ids: ['U1', 'U2'],
        type: 'user/changed'
      })
    )
  ).toEqual([
    ['U1', { name: 'Ann' }],
    ['U2', { name: 'Ann' }]
  ])

  expect(
    parseCrdtRows(tableAction({ ids: ['U1'], type: 'user/deleted' }))
  ).toEqual([['U1', undefined]])
})

it('parses every shape of table actions', () => {
  let tables = { user: USER_SCHEMA }

  expect(
    parseCrdtAction(
      tableAction({ fields: { name: 'Ann' }, id: 'U1', type: 'user/created' }),
      tables
    )
  ).toEqual({ plural: 'user', rows: [['U1', ['name']]], verb: 'created' })

  expect(
    parseCrdtAction(
      tableAction({
        records: [
          { id: 'U1', name: 'Ann' },
          { age: 30, id: 'U2', name: 'Ben' }
        ],
        type: 'user/created'
      }),
      tables
    )
  ).toEqual({
    plural: 'user',
    rows: [
      ['U1', ['name']],
      ['U2', ['age', 'name']]
    ],
    verb: 'created'
  })

  expect(
    parseCrdtAction(
      tableAction({ fields: { age: 30 }, id: 'U1', type: 'user/changed' }),
      tables
    )
  ).toEqual({ plural: 'user', rows: [['U1', ['age']]], verb: 'changed' })

  expect(
    parseCrdtAction(
      tableAction({
        fields: { age: 30, name: 'Ann' },
        ids: ['U1', 'U2'],
        type: 'user/changed'
      }),
      tables
    )
  ).toEqual({
    plural: 'user',
    rows: [
      ['U1', ['age', 'name']],
      ['U2', ['age', 'name']]
    ],
    verb: 'changed'
  })

  expect(
    parseCrdtAction(tableAction({ id: 'U1', type: 'user/deleted' }), tables)
  ).toEqual({ plural: 'user', rows: [['U1', []]], verb: 'deleted' })

  expect(
    parseCrdtAction(
      tableAction({ ids: ['U1', 'U2'], type: 'user/deleted' }),
      tables
    )
  ).toEqual({
    plural: 'user',
    rows: [
      ['U1', []],
      ['U2', []]
    ],
    verb: 'deleted'
  })

  // Fields, which the applier will ignore, are not in the rows
  expect(
    parseCrdtAction(
      tableAction({
        fields: { name: 'Ann', publishedAt: undefined, unknown: 1 },
        id: 'U1',
        type: 'user/changed'
      }),
      tables
    )
  ).toEqual({ plural: 'user', rows: [['U1', ['name']]], verb: 'changed' })

  // Empty batches are added to the log, but change nothing
  expect(
    parseCrdtAction(tableAction({ records: [], type: 'user/created' }), tables)
  ).toEqual({ plural: 'user', rows: [], verb: 'created' })
  expect(
    parseCrdtAction(tableAction({ ids: [], type: 'user/deleted' }), tables)
  ).toEqual({ plural: 'user', rows: [], verb: 'deleted' })
})

it('ignores actions of other tables and types', () => {
  let tables = { user: USER_SCHEMA }
  let ignored = [
    { type: 'logux/processed' },
    { type: 'rename' },
    { fields: {}, id: 'P1', type: 'post/created' },
    { id: 'U1', type: 'user/renamed' },
    { id: 'U1', type: 'user/toString' },
    { fields: {}, id: 'U1', type: 'constructor/created' },
    { id: 'U1', type: 'user/' }
  ]
  for (let action of ignored) {
    expect(parseCrdtAction(tableAction(action), tables)).toBe(false)
  }

  // The verb is taken after the last slash, like in the database itself
  expect(
    parseCrdtAction(
      tableAction({ fields: {}, id: 'U1', type: 'my/user/created' }),
      { 'my/user': USER_SCHEMA }
    )
  ).toEqual({ plural: 'my/user', rows: [['U1', []]], verb: 'created' })
})

it('parses the same cells as the database applies', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  let cells: string[] = []
  crdt.on('applied', (tx, action, meta, won, touched) => {
    let parsed = parseCrdtAction(action, crdt.tables)
    if (!parsed) throw new Error(`Unknown action ${action.type}`)
    let parsedCells: string[] = []
    for (let [id, fields] of parsed.rows) {
      for (let field of fields) {
        parsedCells.push(`${parsed.plural}/${id}/${field}`)
      }
    }
    expect(parsedCells).toEqual(touched.map(cell => cell.join('/')))
    cells.push(...touched.map(cell => cell.join('/')))
  })

  await user.create({ id: 'U1', name: 'Ann' })
  await user.create([
    { id: 'U2', name: 'Ben' },
    { age: 30, id: 'U3', name: 'Cat' }
  ])
  await user.update('U1', { age: 31 })
  await user.update(['U2', 'U3'], { role: 'admin' })
  // Both sides ignore the fields, which are not in the schema
  await client.log.add(
    { fields: { name: 'Dan', unknown: 1 }, id: 'U1', type: 'user/changed' },
    { reasons: ['test'] }
  )
  await user.delete('U1')
  await user.delete(['U2', 'U3'])
  await delay(10)

  // 4 cells of U1, 4 of U2 and 5 of U3, 1 update, 2 in the batch update,
  // 1 of the action with the unknown field, and nothing for the deletes
  expect(cells).toHaveLength(17)
})

it('restores cells of custom actions as table actions', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  let post = crdt.table('post', { title: string() })
  let renamed = defineAction<{ name: string; type: 'renamed' }>('renamed')
  let rename = crdt.action(renamed, async (tx, action, meta) => {
    await user.change(tx, 'U1', { name: action.name }, meta)
    await post.change(tx, 'P1', { title: action.name }, meta)
  })
  await crdt.ready

  let metas: ClientMeta[] = []
  client.on('add', (action, meta) => {
    metas.push(meta)
  })

  await user.create({ id: 'U1', name: 'Ann' })
  await post.create({ id: 'P1', title: 'Old' })
  await rename({ name: 'New' })

  let createdAt = new Date(2026, 0, 1).getTime()
  expect(await crdtTableToActions([user, post])).toEqual([
    [
      {
        fields: { createdAt, isAdmin: 0, role: 'user' },
        id: 'U1',
        type: 'user/created'
      },
      restored(metas[0]!)
    ],
    [
      { fields: { name: 'New' }, id: 'U1', type: 'user/changed' },
      restored(metas[2]!)
    ],
    [
      { fields: { title: 'New' }, id: 'P1', type: 'post/created' },
      restored(metas[2]!)
    ]
  ])
})

it('creates indexes of all definition forms', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA, [
    'name',
    'createdAt DESC',
    'updatedAt_name',
    ['isAdmin', 'name'],
    { columns: ['age', 'name COLLATE NOCASE'], unique: true },
    {
      sql:
        'CREATE INDEX IF NOT EXISTS "user_admins" ON "user" ("name")' +
        ' WHERE "isAdmin" = 1'
    }
  ])
  await crdt.ready

  expect(await indexSqls(db)).toEqual([
    'CREATE INDEX "user_admins" ON "user" ("name") WHERE "isAdmin" = 1',
    'CREATE UNIQUE INDEX "user_age_name" ON "user"' +
      ' ("age", "name" COLLATE NOCASE)',
    'CREATE INDEX "user_createdAt" ON "user" ("createdAt" DESC)',
    'CREATE INDEX "user_isAdmin_name" ON "user" ("isAdmin", "name")',
    'CREATE INDEX "user_name" ON "user" ("name")',
    'CREATE INDEX "user_updatedAt_name" ON "user" ("updatedAt_name")'
  ])

  await user.create({ age: 30, name: 'Ann' })
  await delay(10)
  expect((await loadList(user.select())).map(i => i.name)).toEqual(['Ann'])
})

it('creates indexes after replaying the log on migration', async () => {
  let client = new TestClient('10')
  await client.connect()
  let sqls: string[] = []
  function record<Tx extends DriverTransaction>(origin: Tx): Tx {
    return {
      ...origin,
      exec(query: string, params: SqlParam[]) {
        sqls.push(query)
        return origin.exec(query, params)
      }
    }
  }
  let origin = nodeDriver(':memory:')
  let db = openDb({
    ...record(origin),
    transaction(callback, opts) {
      return origin.transaction(tx => callback(record(tx)), opts)
    }
  })
  await client.log.add(
    { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
    { reasons: ['test'] }
  )

  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA, ['name'])
  await crdt.ready

  let types = sqls
    .map(sql => sql.split(' ').slice(0, 2).join(' '))
    .filter(type => type !== 'SELECT "id",')
  expect(types).toEqual([
    'DROP TABLE',
    'CREATE TABLE',
    'INSERT INTO',
    'CREATE INDEX'
  ])
})

it('applies actions added while the tables were prepared', async () => {
  let client = new TestClient('10')
  await client.connect()
  let origin = nodeDriver(':memory:')
  let user: CrdtTable<typeof USER_SCHEMA>
  let created: Promise<string> | undefined
  // The last step before the database is ready, so the action will be
  // added to the log after the log was replayed to the tables
  async function beforeIndex(query: string): Promise<void> {
    if (query.startsWith('CREATE INDEX') && !created) {
      created = user.create({ name: 'Ann' })
      await delay(10)
    }
  }
  let db = openDb(
    hookExec(origin, async (query, exec) => {
      await beforeIndex(query)
      return exec()
    })
  )

  let crdt = createCrdtDatabase(client, db)
  user = crdt.table('user', USER_SCHEMA, ['name'])
  await crdt.ready

  await created
  expect((await loadList(user.select())).map(i => i.name)).toEqual(['Ann'])
})

it('re-creates the database only when index SQL changed', async () => {
  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  crdt1.table('user', USER_SCHEMA, ['name', 'createdAt DESC'])
  await crdt1.ready
  crdt1.destroy()

  let crdt2 = createCrdtDatabase(client, db)
  crdt2.table('user', USER_SCHEMA, ['createdAt DESC', 'name'])
  let reordered: string[] = []
  crdt2.status.subscribe(state => {
    reordered.push(state)
  })
  await crdt2.ready
  expect(reordered).toEqual(['initializing', 'ready'])
  crdt2.destroy()

  let crdt3 = createCrdtDatabase(client, db)
  crdt3.table('user', USER_SCHEMA, ['name'])
  let changed: string[] = []
  crdt3.status.subscribe(state => {
    changed.push(state)
  })
  await crdt3.ready
  expect(changed).toEqual(['initializing', 'migrating', 'ready'])
  expect(await indexSqls(db)).toEqual([
    'CREATE INDEX "user_name" ON "user" ("name")'
  ])
})

it('resolves ready promise on ready and on outdated', async () => {
  let { client, db } = await setup()
  let migratingCalled = 0
  let crdt = createCrdtDatabase(client, db)
  crdt.on('migrating', () => {
    migratingCalled += 1
  })
  crdt.table('user', USER_SCHEMA)

  let resolved = false
  void crdt.ready.then(() => {
    resolved = true
  })
  expect(resolved).toBe(false)

  await crdt.ready
  expect(resolved).toBe(true)
  expect(crdt.status.get()).toBe('ready')
  expect(migratingCalled).toBe(0)

  let client2 = new TestClient('10')
  let slowDriver: Driver = {
    close() {},
    exec() {
      return new Promise(() => {})
    },
    select() {
      return Promise.resolve([])
    },
    subscribe() {
      return () => {}
    },
    transaction(callback) {
      return callback(slowDriver)
    }
  }
  let crdt2 = createCrdtDatabase(client2, openDb(slowDriver), {
    key: 'other:db'
  })
  crdt2.table('user', USER_SCHEMA)
  await delay(10)
  expect(crdt2.status.get()).toBe('initializing')

  emitStorage('other:db', 'newer-hash')
  await crdt2.ready
  expect(crdt2.status.get()).toBe('outdated')
  crdt2.destroy()
})

it('becomes broken when the database can not be prepared', async () => {
  let client = new TestClient('10')
  await client.connect()
  let error = new Error('No disk space')

  let errors: unknown[] = []
  let crdt = createCrdtDatabase(client, openDb(brokenDriver(error)))
  crdt.on('corrupted', (reason, e) => {
    errors.push(e)
  })
  crdt.table('user', USER_SCHEMA)
  let states: string[] = []
  crdt.status.subscribe(state => {
    states.push(state)
  })

  await crdt.ready
  expect(states).toEqual(['initializing', 'broken'])
  expect(errors).toEqual([error])
  expect(localStorage.getItem('logux:db')).toBeNull()
})

it('becomes broken when the migration failed', async () => {
  let client = new TestClient('10')
  await client.connect()
  let db = openDb(nodeDriver(':memory:'))
  let crdt1 = createCrdtDatabase(client, db)
  crdt1.table('user', USER_SCHEMA)
  await crdt1.ready
  crdt1.destroy()

  let error = new Error('No disk space')
  let client2 = new TestClient('10')
  await client2.connect()
  let crdt2 = createCrdtDatabase(client2, openDb(brokenDriver(error)))
  crdt2.on('corrupted', () => {})
  crdt2.table('user', USER_SCHEMA, ['name'])
  let states: string[] = []
  crdt2.status.subscribe(state => {
    states.push(state)
  })

  await crdt2.ready
  expect(states).toEqual(['initializing', 'migrating', 'broken'])
})

it('rejects pending changes on broken database', async () => {
  let client = new TestClient('10')
  await client.connect()
  let error = new Error('No disk space')
  let crdt = createCrdtDatabase(client, openDb(brokenDriver(error, 10)))
  crdt.on('corrupted', () => {})
  let user = crdt.table('user', USER_SCHEMA)

  let creating = user.create({ name: 'Ann' })
  await delay(1)
  expect(crdt.status.get()).toBe('initializing')

  await crdt.ready
  expect(crdt.status.get()).toBe('broken')
  await expect(creating).rejects.toThrow('The database is broken')
})

it('re-throws the database error without corrupted listener', async () => {
  let client = new TestClient('10')
  await client.connect()
  let error = new Error('No disk space')

  let unhandled: unknown[] = []
  let origin = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', reason => {
    unhandled.push(reason)
  })

  let crdt = createCrdtDatabase(client, openDb(brokenDriver(error)))
  crdt.table('user', USER_SCHEMA)
  await crdt.ready
  await delay(10)

  process.removeAllListeners('unhandledRejection')
  for (let listener of origin) process.on('unhandledRejection', listener)

  expect(crdt.status.get()).toBe('broken')
  expect(unhandled).toEqual([error])
})

it('keeps the tables, but drops the schema on clean() of broken database', async () => {
  let client = new TestClient('10')
  await client.connect()
  let origin = nodeDriver(':memory:')
  let failing = false
  let db = openDb(
    hookExec(origin, (query, exec) => {
      if (failing && query.startsWith('CREATE TABLE')) {
        return Promise.reject(new Error('No disk space'))
      }
      return exec()
    })
  )

  let crdt1 = createCrdtDatabase(client, db)
  let user1 = crdt1.table('user', USER_SCHEMA)
  await crdt1.ready
  await user1.create({ id: 'U1', name: 'Ann' })
  await delay(10)
  crdt1.destroy()
  expect(localStorage.getItem('logux:db')).toBeTypeOf('string')

  failing = true
  let client2 = new TestClient('10')
  await client2.connect()
  let crdt2 = createCrdtDatabase(client2, db)
  crdt2.on('corrupted', () => {})
  crdt2.table('user', USER_SCHEMA)
  await crdt2.ready
  expect(crdt2.status.get()).toBe('broken')

  // The tables can not be changed, but they must be re-created on restart
  await crdt2.clean()
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([
    { id: 'U1' }
  ])
  expect(localStorage.getItem('logux:db')).toBeNull()
})

it('keeps database when schema hash matches', async () => {
  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  let user1 = crdt1.table('user', USER_SCHEMA)
  await delay(10)
  await user1.create({ id: 'U1', name: 'Ann' })
  await delay(10)

  let repeatCalled = 0
  let client2 = new TestClient('10')
  await client2.connect()
  let crdt2 = createCrdtDatabase(client2, db, {
    repeat() {
      repeatCalled += 1
      return []
    }
  })
  let user2 = crdt2.table('user', USER_SCHEMA)
  expect(crdt2.status.get()).toBe('initializing')
  await delay(10)
  expect(crdt2.status.get()).toBe('ready')
  expect(repeatCalled).toBe(0)

  let rows = await loadList(user2.select())
  expect(rows.map(i => i.id)).toEqual(['U1'])
})

it('becomes outdated on storage event with different hash', async () => {
  let { client, db } = await setup()
  let stopCalled = 0
  let crdt = createCrdtDatabase(client, db)
  crdt.on('stop', () => {
    stopCalled += 1
  })
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)
  expect(crdt.status.get()).toBe('ready')

  let $all = user.select()
  $all.listen(() => {})
  expect(await loadList($all)).toEqual([])

  emitStorage('logux:db', localStorage.getItem('logux:db')!)
  emitStorage('other', 'value')
  expect(crdt.status.get()).toBe('ready')
  expect(stopCalled).toBe(0)

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('outdated')
  expect(stopCalled).toBe(1)

  emitStorage('logux:db', 'even-newer-hash')
  expect(stopCalled).toBe(1)

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect(await loadList($all)).toEqual([])
})

it('takes the lock only while applying actions', async () => {
  let { grant, names } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)
  expect(crdt.status.get()).toBe('ready')
  expect(names).toEqual([])

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect(names).toEqual(['logux:db:apply'])
  expect(await loadList(user.select())).toEqual([])

  await grant()
  await delay(10)
  expect((await loadList(user.select())).map(i => i.id)).toEqual(['U1'])
  expect(names).toEqual(['logux:db:apply'])
})

it('does not apply actions after outdate', async () => {
  let { grant } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA)
  await delay(10)

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('outdated')

  await grant()
  await delay(10)
  // Reactive stores are paused on outdated database
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([])
})

it('unsubscribes from the log and from other tabs on destroy()', async () => {
  let { client, db } = await setup()
  let stopCalled = 0
  let crdt = createCrdtDatabase(client, db)
  crdt.on('stop', () => {
    stopCalled += 1
  })
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  await user.create({ id: 'U1', name: 'Ann' })
  await delay(10)
  expect((await loadList(user.select())).map(i => i.id)).toEqual(['U1'])

  crdt.destroy()
  crdt.destroy()

  await client.log.add({
    fields: { name: 'Ben' },
    id: 'U2',
    type: 'user/created'
  })
  await delay(10)
  expect((await loadList(user.select())).map(i => i.id)).toEqual(['U1'])

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('ready')
  expect(stopCalled).toBe(0)
})

it('applies actions of any database over the same log', async () => {
  queuedLocks()

  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  let user1 = crdt1.table('user', USER_SCHEMA)
  let crdt2 = createCrdtDatabase(client, db)
  crdt2.table('user', USER_SCHEMA)
  await delay(10)

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect((await loadList(user1.select())).map(i => i.id)).toEqual(['U1'])

  crdt1.destroy()
  await client.log.add({
    fields: { name: 'Ben' },
    id: 'U2',
    type: 'user/created'
  })
  await delay(10)
  expect((await loadList(user1.select())).map(i => i.id)).toEqual(['U1', 'U2'])

  crdt2.destroy()
})

it('cancels not granted lock request on destroy()', async () => {
  let { grant } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect(unloaders).toHaveLength(1)

  crdt.destroy()
  await delay(10)
  expect(unloaders).toHaveLength(0)

  await grant()
  await delay(10)
  expect(await loadList(user.select())).toEqual([])
})

it('buffers actions added before database is ready', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)

  let $all = user.select()
  $all.listen(() => {})
  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  expect(crdt.status.get()).toBe('initializing')

  await delay(10)
  expect(crdt.status.get()).toBe('ready')
  expect((await loadList($all)).map(i => i.name)).toEqual(['Ann'])
})

it('blocks closing tab until actions will be applied', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)

  await client.log.add({ type: 'logux/subscribe' })
  expect(unloaders).toHaveLength(0)

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  expect(crdt.status.get()).toBe('initializing')
  expect(unloaders).toHaveLength(1)

  let event = { returnValue: '' }
  expect(unloaders[0]!(event)).toBe('applying')
  expect(event.returnValue).toBe('applying')

  await delay(10)
  expect((await loadList(user.select())).map(i => i.name)).toEqual(['Ann'])
  expect(unloaders).toHaveLength(0)
})

it('stops blocking tab closing on outdated database', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA)

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  expect(unloaders).toHaveLength(1)

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('outdated')
  expect(unloaders).toHaveLength(0)

  await delay(10)
  expect(unloaders).toHaveLength(0)
})

it('stops blocking tab closing on destroy()', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA)

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  expect(unloaders).toHaveLength(1)

  crdt.destroy()
  expect(unloaders).toHaveLength(0)

  await delay(10)
  expect(unloaders).toHaveLength(0)
})

it('ignores unknown action types and actions without fields', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  await client.log.add({ type: 'noslash' })
  await client.log.add({
    fields: { name: 'A' },
    id: 'P1',
    type: 'post/created'
  })
  await client.log.add({ id: 'U1', type: 'user/rename' })
  await client.log.add({ id: 'U2', type: 'user/created' })
  await delay(10)

  expect(await loadList(user.select())).toEqual([])
})

it('generates SQL with dialect-specific and extra column SQL', async () => {
  let executed: string[] = []
  let fakeDriver: Driver = {
    close() {},
    exec(sql) {
      executed.push(sql)
      return Promise.resolve()
    },
    select() {
      return Promise.resolve([])
    },
    subscribe() {
      return () => {}
    },
    transaction(callback) {
      return callback(fakeDriver)
    }
  }

  let client = new TestClient('10')
  let crdt = createCrdtDatabase(client, openDb(fakeDriver), {
    dialect: 'pglite'
  })
  crdt.table('user', {
    email: string({ sql: { pglite: 'UNIQUE', sqlite: 'COLLATE NOCASE' } }),
    name: string('COLLATE NOCASE'),
    pinned: boolean(),
    postedAt: bigint(),
    quote: oneOf(["o'ne", 'two'])
  })
  await delay(10)

  expect(executed).toEqual([
    'DROP TABLE IF EXISTS "user"',
    'CREATE TABLE IF NOT EXISTS "user" (' +
      '"id" TEXT PRIMARY KEY, ' +
      '"email" TEXT UNIQUE, ' +
      '"name" TEXT COLLATE NOCASE, ' +
      '"pinned" BOOLEAN, ' +
      '"postedAt" BIGINT, ' +
      `"quote" TEXT CHECK ("quote" IN ('o''ne', 'two')), ` +
      '"updatedAt_email" TEXT, ' +
      '"updatedAt_name" TEXT, ' +
      '"updatedAt_pinned" TEXT, ' +
      '"updatedAt_postedAt" TEXT, ' +
      '"updatedAt_quote" TEXT)'
  ])
})

it('allows to replace localStorage key for third-party widgets', async () => {
  let { client, db } = await setup()
  let stopCalled = 0
  let crdt = createCrdtDatabase(client, db, {
    key: 'widget:db'})
  crdt.on('stop', () => {
    stopCalled += 1
  })
  crdt.table('user', USER_SCHEMA)
  await delay(10)
  expect(crdt.status.get()).toBe('ready')
  expect(localStorage.getItem('widget:db')).toBeTypeOf('string')
  expect(localStorage.getItem('logux:db')).toBeNull()

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('ready')
  expect(stopCalled).toBe(0)

  emitStorage('widget:db', 'newer-hash')
  expect(crdt.status.get()).toBe('outdated')
  expect(stopCalled).toBe(1)
})

it('allows to replace localStorage with custom storage', async () => {
  let { client, db } = await setup()
  let storage: Record<string, string | undefined> = {}
  let stopCalled = 0
  let crdt = createCrdtDatabase(client, db, {
    storage
  })
  crdt.on('stop', () => {
    stopCalled += 1
  })
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready
  expect(crdt.status.get()).toBe('ready')
  expect(storage['logux:db']).toContain('"user":')
  expect(localStorage.getItem('logux:db')).toBeNull()

  await user.create({ name: 'Ann' })
  expect((await loadList(user.select())).map(i => i.name)).toEqual(['Ann'])

  // Custom storage has no `storage` events
  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('ready')
  expect(stopCalled).toBe(0)

  await crdt.clean()
  expect(storage['logux:db']).toBeUndefined()
})

it('rebuilds database on schema change in custom storage', async () => {
  let { client, db } = await setup()
  let storage: Record<string, string | undefined> = { 'logux:db': '{}' }
  await client.log.add(
    { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
    { reasons: ['test'] }
  )

  let crdt = createCrdtDatabase(client, db, { storage })
  let user = crdt.table('user', USER_SCHEMA)
  let statuses: string[] = []
  crdt.status.subscribe(state => {
    statuses.push(state)
  })
  await crdt.ready

  expect(statuses).toEqual(['initializing', 'migrating', 'ready'])
  expect((await loadList(user.select())).map(i => i.name)).toEqual(['Ann'])
  expect(storage['logux:db']).toContain('"user":')
})

it('filters rows by JOIN with another table in select()', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  let post = crdt.table('post', {
    authorId: string(),
    draft: number({ default: 1 }),
    title: string()
  })
  await delay(10)

  await user.create({ id: 'U1', name: 'Ann' })
  await user.create({ id: 'U2', name: 'Ben' })
  await post.create({ authorId: 'U1', draft: 0, title: 'A' })
  await post.create({ authorId: 'U2', title: 'B' })
  await delay(10)

  let $published = user.select`
    JOIN "post" ON "post"."authorId" = "user"."id"
    WHERE "post"."draft" = ${0}
  `
  let rows = await loadList($published)
  expect(rows.map(i => i.id)).toEqual(['U1'])
  expect(rows[0]!.name).toBe('Ann')
  expect(rows[0]!.isAdmin).toBe(0)
  expect(rows[0]!.updatedAt_name).toBeTypeOf('string')
})

it('supports manual SQL with joined columns and aggregations', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  let post = crdt.table('post', {
    authorId: string(),
    publishedAt: optional(bigint()),
    title: string()
  })
  await delay(10)

  await user.create({ id: 'U1', name: 'Ann' })
  await post.create({ authorId: 'U1', publishedAt: 3000, title: 'A' })
  await post.create({ authorId: 'U1', title: 'Draft' })
  await delay(10)

  let $feed = db.store<{ author: string; publishedAt: number; title: string }>`
    SELECT "post"."title", "user"."name" AS "author", "post"."publishedAt"
    FROM "post" JOIN "user" ON "user"."id" = "post"."authorId"
    WHERE "post"."publishedAt" > ${2000}
  `
  let rows = await loadList($feed)
  expect(rows).toEqual([{ author: 'Ann', publishedAt: 3000, title: 'A' }])

  let $count = db.store<{
    posts: number
  }>`SELECT COUNT(*) AS "posts" FROM "post"`
  expect(await loadList($count)).toEqual([{ posts: 2 }])

  await user.update('U1', { name: 'Anna' })
  await delay(10)
  expect((await loadList($feed))[0]!.author).toBe('Anna')
})

it('removes fields meta from rows', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  await user.create([
    { id: 'U1', name: 'Ann' },
    { age: 20, id: 'U2', name: 'Ben', publishedAt: 3000 }
  ])
  await delay(10)

  let rows = await loadList(user.select`ORDER BY "id"`)
  expect(rows[0]!.updatedAt_name).toBeTypeOf('string')
  expect(withoutMeta(rows)).toEqual([
    {
      age: null,
      createdAt: new Date(2026, 0, 1).getTime(),
      id: 'U1',
      isAdmin: 0,
      name: 'Ann',
      publishedAt: null,
      role: 'user'
    },
    {
      age: 20,
      createdAt: new Date(2026, 0, 1).getTime(),
      id: 'U2',
      isAdmin: 0,
      name: 'Ben',
      publishedAt: 3000,
      role: 'user'
    }
  ])
  expect(withoutMeta([])).toEqual([])

  expect(
    Object.keys(withMeta<UserValue>(withoutMeta(rows)[0]!)).sort()
  ).toEqual(Object.keys(rows[0]!).sort())
})

it('adds empty fields meta to rows', () => {
  expect(
    withMeta<UserValue>({
      age: null,
      createdAt: 1000,
      id: 'U1',
      isAdmin: 0,
      name: 'Ann',
      publishedAt: null,
      role: 'user'
    })
  ).toEqual({
    age: null,
    createdAt: 1000,
    id: 'U1',
    isAdmin: 0,
    name: 'Ann',
    publishedAt: null,
    role: 'user',
    updatedAt_age: null,
    updatedAt_createdAt: null,
    updatedAt_isAdmin: null,
    updatedAt_name: null,
    updatedAt_publishedAt: null,
    updatedAt_role: null
  })
})

it('throws on table() call after initialization', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA)
  await delay(10)

  expect(() => {
    crdt.table('post', { title: string() })
  }).toThrow(/sync/)
})

it('throws on unknown column in index', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  expect(() => {
    // @ts-expect-error
    crdt.table('user', USER_SCHEMA, ['missing'])
  }).toThrow('Unknown column "missing" in "user" index')
  expect(() => {
    // @ts-expect-error
    crdt.table('user', USER_SCHEMA, [['name', 'updatedAt_missing DESC']])
  }).toThrow('Unknown column "updatedAt_missing" in "user" index')
})

it('throws on two indexes with the same name', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  expect(() => {
    crdt.table('user', USER_SCHEMA, [
      'name',
      { columns: ['name'], unique: true }
    ])
  }).toThrow('Duplicate index name "user_name"')
})

it('throws on column type unsupported by dialect', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  expect(() => {
    // @ts-expect-error
    crdt.table('user', { isAdmin: boolean() })
  }).toThrow('sqlite does not support boolean')
})

it('throws on column name reserved for fields meta', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  expect(() => {
    crdt.table('user', { name: string(), updatedAt_name: string() })
  }).toThrow('updatedAt_ prefix is reserved for fields meta')
})

it('applies custom actions to the database', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)

  let userRenamed = defineAction<{
    id: string
    name: string
    type: 'user/renamed'
  }>('user/renamed')
  let calls: string[] = []
  let renameUser = crdt.action(userRenamed, async (tx, action, meta) => {
    calls.push(action.name)
    await user.change(tx, action.id, { name: action.name }, meta)
    await tx.exec`
      UPDATE "user" SET "isAdmin" = ${1} WHERE "id" = ${action.id}
    `
  })
  await delay(10)

  await user.create({ id: 'U1', name: 'Ann' })
  await delay(10)

  await renameUser({ id: 'U1', name: 'New' })
  await delay(10)
  expect(calls).toEqual(['New'])
  let rows = await loadList(user.select())
  expect(rows[0]!.name).toBe('New')
  expect(rows[0]!.isAdmin).toBe(1)
  expect(rows[0]!.updatedAt_name).toBeTypeOf('string')

  let sent = await client.sent(async () => {
    await renameUser({ id: 'U1', name: 'Sent' })
    await delay(10)
  })
  expect(sent).toEqual([{ id: 'U1', name: 'Sent', type: 'user/renamed' }])
})

it('resolves conflicts of custom actions by action meta', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  let userRenamed = defineAction<{
    id: string
    name: string
    type: 'user/renamed'
  }>('user/renamed')
  crdt.action(userRenamed, async (tx, action, meta) => {
    await user.change(tx, action.id, { name: action.name }, meta)
  })
  await delay(10)

  await client.log.add(
    { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
    { id: '0Z 10:other', time: 100 }
  )
  await delay(10)

  await client.log.add(
    { id: 'U1', name: 'Older', type: 'user/renamed' },
    { id: '9 10:other', time: 10 }
  )
  await client.log.add(
    { id: 'U2', name: 'Unknown', type: 'user/renamed' },
    { id: '27 10:other', time: 200 }
  )
  await delay(10)
  expect((await loadList(user.select())).map(i => i.name)).toEqual(['Ann'])

  await client.log.add(
    { id: 'U1', name: 'Newer', type: 'user/renamed' },
    { id: '3g 10:other', time: 300 }
  )
  await delay(10)
  expect((await loadList(user.select())).map(i => i.name)).toEqual(['Newer'])
})

it('replays custom actions on schema change', async () => {
  let { client, db } = await setup()
  let userRenamed = defineAction<{
    id: string
    name: string
    type: 'user/renamed'
  }>('user/renamed')
  await client.log.add(
    { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
    { reasons: ['test'] }
  )
  await client.log.add(
    { id: 'U1', name: 'FromLog', type: 'user/renamed' },
    { reasons: ['test'] }
  )

  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  crdt.action(userRenamed, async (tx, action, meta) => {
    await user.change(tx, action.id, { name: action.name }, meta)
  })
  await delay(10)

  expect((await loadList(user.select())).map(i => i.name)).toEqual(['FromLog'])
  expect(localStorage.getItem('logux:db')).toContain('"user/renamed":null')
})

it('re-creates database on custom actions changes', async () => {
  let { client, db } = await setup()
  let userRenamed = defineAction<{ type: 'user/renamed' }>('user/renamed')

  let crdt1 = createCrdtDatabase(client, db)
  crdt1.table('user', USER_SCHEMA)
  await delay(10)
  let withoutActions = localStorage.getItem('logux:db')
  crdt1.destroy()

  let crdt2 = createCrdtDatabase(client, db)
  crdt2.table('user', USER_SCHEMA)
  crdt2.action(userRenamed, () => {})
  await delay(10)
  let withAction = localStorage.getItem('logux:db')
  expect(withAction).not.toBe(withoutActions)
  crdt2.destroy()

  let crdt3 = createCrdtDatabase(client, db)
  crdt3.table('user', USER_SCHEMA)
  crdt3.action(userRenamed, () => {}, { version: 2 })
  await delay(10)
  expect(localStorage.getItem('logux:db')).not.toBe(withAction)
})

it('throws on action() call after initialization', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA)
  await delay(10)

  expect(() => {
    crdt.action(
      defineAction<{ type: 'user/renamed' }>('user/renamed'),
      () => {}
    )
  }).toThrow(/sync/)
})

it('applies many actions in a single transaction', async () => {
  let { client, db } = await setup()
  for (let i = 0; i < 1000; i++) {
    await client.log.add(
      { fields: { name: `User ${i}` }, id: `U${i}`, type: 'user/created' },
      { reasons: ['test'] }
    )
  }

  let transactions = 0
  let origin = db.driver.transaction.bind(db.driver)
  db.driver.transaction = (callback, opts) => {
    transactions += 1
    return origin(callback, opts)
  }

  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA, ['name'])
  await crdt.ready

  // The schema, the replay of all actions, and the indexes
  expect(transactions).toBe(3)
  expect(
    await db.driver.select('SELECT count(*) AS "count" FROM "user"', [])
  ).toEqual([{ count: 1000 }])
})

it('finishes applying, which was interrupted by tab closing', async () => {
  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  crdt1.table('user', USER_SCHEMA)
  await crdt1.ready

  let broken = true
  let origin = db.driver.transaction.bind(db.driver)
  db.driver.transaction = (callback, opts) => {
    return origin(tx => {
      let originExec = tx.exec.bind(tx)
      tx.exec = (sql, params) => {
        if (broken && sql.startsWith('INSERT INTO "user"')) {
          throw new Error('Tab was closed')
        }
        return originExec(sql, params)
      }
      return callback(tx)
    }, opts)
  }

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([])

  let kept: string[] = []
  await client.log.each((action, actionMeta) => {
    if (actionMeta.reasons.includes('applying-to-db')) kept.push(action.type)
  })
  expect(kept).toEqual(['user/created'])

  crdt1.destroy()
  broken = false

  let crdt2 = createCrdtDatabase(client, db)
  let user2 = crdt2.table('user', USER_SCHEMA)
  await crdt2.ready
  expect((await loadList(user2.select())).map(i => i.id)).toEqual(['U1'])

  kept = []
  await client.log.each((action, actionMeta) => {
    if (actionMeta.reasons.includes('applying-to-db')) kept.push(action.type)
  })
  expect(kept).toEqual([])
  crdt2.destroy()
})

it('applies repeated created and deleted actions', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  for (let repeat of [1, 2]) {
    await client.log.add(
      { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
      { id: `10${repeat} 10:other 0`, time: 100 }
    )
    await client.log.add(
      { id: 'U1', type: 'user/deleted' },
      { id: `20${repeat} 10:other 0`, time: 200 }
    )
  }
  await delay(10)

  expect(await loadList(user.select())).toEqual([])
})
it('applies actions in the transaction of SQL log store', async () => {
  let db = openDb(nodeDriver(':memory:'))
  let store = new SqlLogStore(db)
  let client = new Client({
    server: 'ws://localhost',
    store,
    subprotocol: 1,
    userId: '10'
  })
  let applied: string[] = []
  let crdt = createCrdtDatabase(client, db)
  crdt.on('applied', (tx, action) => {
    applied.push(action.type)
  })
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  let id = await user.create({ name: 'Ann' })
  // The row is in the database right after create(), without any delay
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([
    { id }
  ])

  await user.update(id, { name: 'New' })
  expect(await db.driver.select('SELECT "name" FROM "user"', [])).toEqual([
    { name: 'New' }
  ])

  await delay(10)
  let kept: string[] = []
  await client.log.each((action, meta) => {
    if (meta.reasons.includes('applying-to-db')) kept.push(action.type)
  })
  expect(kept).toEqual([])

  // Actions from the network are applied by batches in store’s transaction
  store.onTransactionAdd(undefined)
  await client.log.add({ id, type: 'user/deleted' })
  await delay(10)
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([])
  expect(applied).toEqual(['user/created', 'user/changed', 'user/deleted'])

  crdt.destroy()
  await db.close()
})

it('does not add action to the log if applying failed', async () => {
  let db = openDb(nodeDriver(':memory:'))
  let client = new Client({
    server: 'ws://localhost',
    store: new SqlLogStore(db),
    subprotocol: 1,
    userId: '10'
  })
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  await db.driver.exec('DROP TABLE "user"', [])

  let error: Error | undefined
  try {
    await user.create({ name: 'Ann' })
  } catch (e) {
    error = e as Error
  }
  expect(error).toBeDefined()

  let types: string[] = []
  await client.log.each(action => {
    types.push(action.type)
  })
  expect(types).toEqual([])

  crdt.destroy()
  await db.close()
})

it('resolves table methods only after applying to the database', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  let userRenamed = defineAction<{
    id: string
    name: string
    type: 'user/renamed'
  }>('user/renamed')
  let renameUser = crdt.action(userRenamed, async (tx, action, meta) => {
    await user.change(tx, action.id, { name: action.name }, meta)
  })
  await crdt.ready

  async function names(): Promise<string[]> {
    let rows = (await db.driver.select('SELECT "name" FROM "user"', [])) as {
      name: string
    }[]
    return rows.map(i => i.name)
  }

  let id = await user.create({ name: 'Ann' })
  expect(await names()).toEqual(['Ann'])

  await user.update(id, { name: 'Updated' })
  expect(await names()).toEqual(['Updated'])

  await renameUser({ id, name: 'Renamed' })
  expect(await names()).toEqual(['Renamed'])

  let ids = await user.create([{ name: 'Ben' }, { name: 'Cat' }])
  expect(await names()).toHaveLength(3)

  await user.update(ids, { name: 'Both' })
  expect(await names()).toEqual(['Renamed', 'Both', 'Both'])

  await user.delete(ids)
  expect(await names()).toEqual(['Renamed'])

  await user.delete(id)
  expect(await names()).toEqual([])
})

it('rejects table methods on database stop', async () => {
  let { grant } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  let creating = user.create({ name: 'Ann' })
  await delay(10)
  crdt.destroy()
  await expect(creating).rejects.toThrow('The database was stopped')

  await grant()
})

it('rejects table methods if applying failed', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  await db.driver.exec('DROP TABLE "user"', [])
  await expect(user.create({ name: 'Ann' })).rejects.toThrow(/user/)

  crdt.destroy()
})

it('removes reasons of applied actions by batches', async () => {
  let { client, db } = await setup()
  for (let id of ['U1', 'U2', 'U3']) {
    await client.log.add(
      { fields: { name: id }, id, type: 'user/created' },
      { reasons: ['applying-to-db'] }
    )
  }

  let calls = 0
  let origin = client.log.removeReason.bind(client.log)
  client.log.removeReason = (reason, criteria) => {
    calls += 1
    return origin(reason, criteria)
  }

  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready
  await delay(10)

  expect(calls).toBe(1)
  let kept: string[] = []
  await client.log.each((action, meta) => {
    if (meta.reasons.includes('applying-to-db')) kept.push(action.type)
  })
  expect(kept).toEqual([])
  expect(await loadList(user.select())).toHaveLength(3)

  crdt.destroy()
})

it('does not send table actions to the server with sync: false', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db, { sync: false })
  let user = crdt.table('user', USER_SCHEMA)
  let userRenamed = defineAction<{
    id: string
    name: string
    type: 'user/renamed'
  }>('user/renamed')
  let rename = crdt.action(userRenamed, async (tx, action, meta) => {
    await user.change(tx, action.id, { name: action.name }, meta)
  })
  await crdt.ready

  let synced: (boolean | undefined)[] = []
  let reasons: string[][] = []
  client.on('add', (action, meta) => {
    synced.push(meta.sync)
    reasons.push([...meta.reasons])
  })

  let sent = await client.sent(async () => {
    await user.create({ id: 'U1', name: 'Ann' })
    await user.update('U1', { age: 30 })
    await rename({ id: 'U1', name: 'New' })
    await user.delete('U1')
    await delay(10)
  })

  expect(sent).toEqual([])
  expect(synced).toEqual([undefined, undefined, undefined, undefined])
  // Without `sync` Logux adds no `syncing` reason, so the action is kept
  // only until it will be applied to the tables
  expect(reasons).toEqual([
    ['applying-to-db'],
    ['applying-to-db'],
    ['applying-to-db'],
    ['applying-to-db']
  ])
  expect(client.log.entries()).toEqual([])
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([])
})

it('does not put applied actions from the server to the log', async () => {
  let db = openDb(nodeDriver(':memory:'))
  let store = new SqlLogStore(db)
  let client = new Client({
    server: 'ws://localhost',
    store,
    subprotocol: 1,
    userId: '10'
  })
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  let calls = 0
  let origin = client.log.removeReason.bind(client.log)
  client.log.removeReason = (reason, criteria) => {
    calls += 1
    return origin(reason, criteria)
  }

  // Actions from the server have no reason to be kept in the log,
  // so they are applied by batches without touching the log tables
  await Promise.all([
    client.log.add({ fields: { name: 'Ann' }, id: 'U1', type: 'user/created' }),
    client.log.add({ fields: { name: 'Ben' }, id: 'U2', type: 'user/created' })
  ])
  await delay(10)
  expect(await loadList(user.select())).toHaveLength(2)
  expect(calls).toBe(0)

  let types: string[] = []
  await client.log.each(action => {
    types.push(action.type)
  })
  expect(types).toEqual([])

  crdt.destroy()
  await db.close()
})

it('does not add reason to actions applied in the log transaction', async () => {
  let db = openDb(nodeDriver(':memory:'))
  let store = new SqlLogStore(db)
  let client = new Client({
    server: 'ws://localhost',
    store,
    subprotocol: 1,
    userId: '10'
  })
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  let calls = 0
  let origin = client.log.removeReason.bind(client.log)
  client.log.removeReason = (reason, criteria) => {
    calls += 1
    return origin(reason, criteria)
  }

  // Other tabs receive the meta from the `add` event, so they will not
  // apply the action to the same database for the second time
  let added: string[][] = []
  client.on('add', (action, meta) => {
    if (action.type === 'user/created') added.push([...meta.reasons])
  })

  let id = await user.create({ name: 'Ann' })
  await delay(10)
  expect(added).toEqual([['syncing']])
  expect(calls).toBe(0)
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([
    { id }
  ])

  crdt.destroy()
  await db.close()
})

it('does not write local-only actions to the log in the same database', async () => {
  let db = openDb(nodeDriver(':memory:'))
  let store = new SqlLogStore(db)
  let client = new Client({
    server: 'ws://localhost',
    store,
    subprotocol: 1,
    userId: '10'
  })
  let crdt = createCrdtDatabase(client, db, { sync: false })
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  let added: string[][] = []
  client.on('add', (action, meta) => {
    if (action.type === 'user/created') added.push([...meta.reasons])
  })

  // Nothing waits for the action: the tables are the only state
  let id = await user.create({ name: 'Ann' })
  await delay(10)
  expect(added).toEqual([[]])
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([
    { id }
  ])

  let types: string[] = []
  await client.log.each(action => {
    types.push(action.type)
  })
  expect(types).toEqual([])

  crdt.destroy()
  await db.close()
})

it('keeps reason on actions of outdated database', async () => {
  let db = openDb(nodeDriver(':memory:'))
  let store = new SqlLogStore(db)
  let client = new Client({
    server: 'ws://localhost',
    store,
    subprotocol: 1,
    userId: '10'
  })
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('outdated')

  // The action was not applied here, so the tab with the new schema
  // should be able to find it in the log
  await user.create({ id: 'U1', name: 'Ann' })
  await delay(10)
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([])

  let kept: string[] = []
  await client.log.each((action, meta) => {
    if (meta.reasons.includes('applying-to-db')) kept.push(action.type)
  })
  expect(kept).toEqual(['user/created'])

  crdt.destroy()
  await db.close()
})

it('does not report the corruption of the tables after empty()', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  await user.create({ id: 'U1', name: 'Ann' })
  // The action is applied by the drain inside empty(), so the applier
  // marks the tables as filled during the call
  await client.log.add(
    { fields: { name: 'Ben' }, id: 'U2', type: 'user/created' },
    { reasons: ['test'] }
  )
  await crdt.empty()
  crdt.destroy()

  let client2 = new TestClient('10')
  await client2.connect()
  let crdt2 = createCrdtDatabase(client2, db)
  crdt2.table('user', USER_SCHEMA)
  let reasons: CrdtCorruption[] = []
  crdt2.on('corrupted', reason => {
    reasons.push(reason)
  })

  await crdt2.ready
  expect(reasons).toEqual([])
  crdt2.destroy()
})

it('empties all tables keeping the database ready', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA, ['name'])
  let post = crdt.table('post', { title: string() })
  await crdt.ready

  await user.create({ id: 'U1', name: 'Ann' })
  await post.create({ id: 'P1', title: 'About' })
  let $users = user.select()
  expect(await loadList($users)).toHaveLength(1)

  // Actions from the queue must be applied before the tables were emptied
  await client.log.add(
    { fields: { name: 'Ben' }, id: 'U2', type: 'user/created' },
    { sync: true }
  )
  await crdt.empty()

  expect(await loadList($users)).toEqual([])
  expect(await loadList(post.select())).toEqual([])
  expect(await tableNames(db)).toEqual(['post', 'user'])
  expect(await indexSqls(db)).toEqual([
    'CREATE INDEX "user_name" ON "user" ("name")'
  ])
  expect(localStorage.getItem('logux:db')).toBeTypeOf('string')
  cleanStores($users)

  await user.create({ id: 'U3', name: 'Cat' })
  expect((await loadList(user.select())).map(i => i.id)).toEqual(['U3'])
})

it('drops all tables on clean()', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  let post = crdt.table('post', { title: string() })
  await crdt.ready

  await user.create({ id: 'U1', name: 'Ann' })
  await post.create({ id: 'P1', title: 'About' })
  let $all = user.select()
  expect(await loadList($all)).toHaveLength(1)
  cleanStores($all)
  expect(await tableNames(db)).toEqual(['post', 'user'])

  await crdt.clean()

  expect(await tableNames(db)).toEqual([])
})

it('drops tables on client.clean()', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready
  await user.create({ id: 'U1', name: 'Ann' })

  await client.clean()

  expect(await tableNames(db)).toEqual([])
  expect(localStorage.getItem('logux:db')).toBeNull()
})

it('does not drop tables on client.clean() after destroy()', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready
  await user.create({ id: 'U1', name: 'Ann' })

  // Another database in this tab or another tab owns the tables now
  crdt.destroy()
  await client.clean()

  expect(await tableNames(db)).toEqual(['user'])
  expect(localStorage.getItem('logux:db')).toBeTypeOf('string')
})

it('pauses reactive stores on clean()', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready
  await user.create({ id: 'U1', name: 'Ann' })

  await crdt.clean()

  // The page will be reloaded, but stores, mounted before the reload,
  // should not ask the driver for the dropped tables
  let $all = user.select()
  $all.listen(() => {})
  await delay(10)
  expect($all.get()).toEqual({ isLoading: true })

  cleanStores($all)
})

it('does not fill tables back by actions applied during clean()', async () => {
  let { grant, names } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA)
  await crdt.ready

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  // The action is in the chunk, which waits for the lock
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([])

  let cleaning = crdt.clean()
  await grant()
  await cleaning
  // The chunk was applied, since it was already in the transaction,
  // and the tables were dropped under the same lock
  expect(names).toEqual(['logux:db:apply'])
  expect(await tableNames(db)).toEqual([])

  await client.log.add({
    fields: { name: 'Ben' },
    id: 'U2',
    type: 'user/created'
  })
  await delay(10)
  expect(await tableNames(db)).toEqual([])
})

it('does not fill tables back by actions of SQL log store', async () => {
  let db = openDb(nodeDriver(':memory:'))
  let store = new SqlLogStore(db)
  let client = new Client({
    server: 'ws://localhost',
    store,
    subprotocol: 1,
    userId: '10'
  })
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  await user.create({ id: 'U1', name: 'Ann' })
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([
    { id: 'U1' }
  ])

  // The action is added to the log in parallel with the cleaning
  let creating = user.create({ id: 'U2', name: 'Ben' })
  await crdt.clean()
  await creating
  await delay(10)

  // Log store’s tables are not touched, the log is cleaned by client.clean()
  let names = await tableNames(db)
  expect(names).not.toContain('user')
  expect(names).toContain('logux_log')
  await db.close()
})

it('rejects table methods on clean()', async () => {
  let { grant } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  let creating = user.create({ id: 'U1', name: 'Ann' })
  let updating = user.update('U1', { name: 'New' })
  let deleting = user.delete('U1')
  await delay(10)

  let cleaning = crdt.clean()
  let message = 'The database was cleaned'
  await expect(creating).rejects.toThrow(message)
  await expect(updating).rejects.toThrow(message)
  await expect(deleting).rejects.toThrow(message)

  await grant()
  await cleaning
  expect(await tableNames(db)).toEqual([])
})

it('forgets schema version to re-create tables from the log', async () => {
  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  crdt1.table('user', USER_SCHEMA)
  await crdt1.ready

  await client.log.add(
    { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
    { reasons: ['test'] }
  )
  await delay(10)
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([
    { id: 'U1' }
  ])

  await crdt1.clean()
  expect(localStorage.getItem('logux:db')).toBeNull()
  expect(await tableNames(db)).toEqual([])

  let crdt2 = createCrdtDatabase(client, db)
  let user2 = crdt2.table('user', USER_SCHEMA)
  let statuses: string[] = []
  crdt2.status.subscribe(state => {
    statuses.push(state)
  })
  await crdt2.ready

  expect(statuses).toEqual(['initializing', 'ready'])
  expect((await loadList(user2.select())).map(i => i.id)).toEqual(['U1'])
  expect(localStorage.getItem('logux:db')).toBeTypeOf('string')

  crdt2.destroy()
})

it('deletes nothing on clean() of outdated database', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready

  await user.create({ id: 'U1', name: 'Ann' })
  let hash = localStorage.getItem('logux:db')

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('outdated')

  // The tab with the newer schema owns the tables
  await crdt.clean()
  expect(await db.driver.select('SELECT "id" FROM "user"', [])).toEqual([
    { id: 'U1' }
  ])
  expect(localStorage.getItem('logux:db')).toBe(hash)
})

function manualReady(): {
  crdt: { ready: Promise<void> }
  ready: () => void
} {
  let ready: () => void = () => {}
  let promise = new Promise<void>(resolve => {
    ready = resolve
  })
  return { crdt: { ready: promise }, ready }
}

it('runs the tasks in the order after the database is ready', async () => {
  let { crdt, ready } = manualReady()
  let tasks = createCrdtTasks(crdt)
  let calls: string[] = []

  tasks.add(() => {
    calls.push('first')
  })
  tasks.add(async () => {
    await delay(10)
    calls.push('second')
  })
  await delay(20)
  expect(calls).toEqual([])

  ready()
  await tasks.finish()
  expect(calls).toEqual(['first', 'second'])
})

it('runs the tasks one by one', async () => {
  let { crdt, ready } = manualReady()
  let tasks = createCrdtTasks(crdt)
  ready()

  let running = 0
  let parallel = 0
  for (let i = 0; i < 3; i++) {
    tasks.add(async () => {
      running += 1
      parallel = Math.max(parallel, running)
      await delay(10)
      running -= 1
    })
  }

  await tasks.finish()
  expect(parallel).toBe(1)
})

it('waits for the added tasks in finish()', async () => {
  let { crdt, ready } = manualReady()
  let tasks = createCrdtTasks(crdt)
  ready()

  let calls: string[] = []
  tasks.add(async () => {
    await delay(10)
    calls.push('first')
  })
  tasks.add(async () => {
    await delay(10)
    calls.push('second')
  })

  await tasks.finish()
  expect(calls).toEqual(['first', 'second'])
})

it('drops the queue on destroy', async () => {
  let { crdt, ready } = manualReady()
  let tasks = createCrdtTasks(crdt)
  let calls: string[] = []

  tasks.add(() => {
    calls.push('task')
  })
  tasks.destroy()
  await tasks.finish()
  expect(calls).toEqual([])

  // The database, which was never ready, does not start the dropped queue
  ready()
  await delay(10)
  expect(calls).toEqual([])
})

it('reports the error and keeps the queue working', async () => {
  let { crdt, ready } = manualReady()
  let errors: unknown[] = []
  let tasks = createCrdtTasks(crdt, {
    onError(error) {
      errors.push(error)
    }
  })
  ready()

  let calls: string[] = []
  tasks.add(() => {
    throw new Error('Task error')
  })
  tasks.add(() => {
    calls.push('next')
  })

  await tasks.finish()
  expect(errors).toEqual([new Error('Task error')])
  expect(calls).toEqual(['next'])
})

it('prints the error by default', async () => {
  let { crdt, ready } = manualReady()
  let error = vi.spyOn(console, 'error').mockImplementation(() => {})
  let tasks = createCrdtTasks(crdt)
  ready()

  tasks.add(() => {
    throw new Error('Task error')
  })

  await tasks.finish()
  expect(error).toHaveBeenCalledWith(new Error('Task error'))
  error.mockRestore()
})

it('ignores the error of the task, which was destroyed', async () => {
  let { crdt, ready } = manualReady()
  let errors: unknown[] = []
  let tasks = createCrdtTasks(crdt, {
    onError(error) {
      errors.push(error)
    }
  })
  ready()

  tasks.add(async () => {
    await delay(10)
    throw new Error('Task error')
  })
  await delay(5)
  tasks.destroy()

  await tasks.finish()
  expect(errors).toEqual([])
})

it('writes to the log from the applied event', async () => {
  let db = openDb(nodeDriver(':memory:'))
  let client = new Client({
    server: 'ws://localhost',
    store: new SqlLogStore(db),
    subprotocol: 1,
    userId: '10'
  })
  // Without the server the action is kept only by the reason of the test
  let crdt = createCrdtDatabase(client, db, { sync: false })
  let user = crdt.table('user', USER_SCHEMA)
  let tasks = createCrdtTasks(crdt)

  client.log.on('preadd', (action, meta) => {
    if (action.type === 'user/created') meta.reasons.push('test')
  })
  crdt.on('applied', (tx, action, meta) => {
    tasks.add(async () => {
      await client.log.removeReason('test', { id: meta.id })
    })
  })

  await crdt.ready
  await user.create({ name: 'Ann' })
  await delay(10)

  // The write inside the applying transaction would wait for it forever
  await tasks.finish()
  let types: string[] = []
  await client.log.each(action => {
    types.push(action.type)
  })
  expect(types).toEqual([])

  tasks.destroy()
  crdt.destroy()
  await db.close()
})

it('reports the hanging database by the timeout', async () => {
  let client = new TestClient('10')
  await client.connect()
  let crdt = createCrdtDatabase(client, openDb(hangingDriver()), {
    timeout: 20
  })
  crdt.table('user', USER_SCHEMA)
  let reasons: CrdtCorruption[] = []
  crdt.on('corrupted', reason => {
    reasons.push(reason)
  })

  await delay(10)
  expect(reasons).toEqual([])

  await delay(20)
  expect(reasons).toEqual(['timeout'])
  expect(crdt.status.get()).toBe('initializing')

  crdt.destroy()
})

it('does not report the database, which was prepared in time', async () => {
  let { client, db } = await setup()
  let reasons: CrdtCorruption[] = []
  let crdt = createCrdtDatabase(client, db, {
    timeout: 20
  })
  crdt.on('corrupted', reason => {
    reasons.push(reason)
  })
  crdt.table('user', USER_SCHEMA)

  await crdt.ready
  await delay(30)
  expect(reasons).toEqual([])

  crdt.destroy()
})

it('reports the error of the database as the corruption', async () => {
  let client = new TestClient('10')
  await client.connect()
  let error = new Error('No disk space')
  let reported: [CrdtCorruption, unknown][] = []
  let crdt = createCrdtDatabase(client, openDb(brokenDriver(error)))
  crdt.on('corrupted', (reason, e) => {
    reported.push([reason, e])
  })
  crdt.table('user', USER_SCHEMA)

  await crdt.ready
  await delay(10)
  expect(reported).toEqual([['error', error]])
  expect(crdt.status.get()).toBe('broken')
})

it('does not re-throw the database error with corrupted listener', async () => {
  let client = new TestClient('10')
  await client.connect()
  let unhandled: unknown[] = []
  let origin = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', reason => {
    unhandled.push(reason)
  })

  let reasons: CrdtCorruption[] = []
  let crdt = createCrdtDatabase(
    client,
    openDb(brokenDriver(new Error('No disk space')))
  )
  crdt.table('user', USER_SCHEMA)
  crdt.on('corrupted', reason => {
    reasons.push(reason)
  })

  await crdt.ready
  await delay(10)

  process.removeAllListeners('unhandledRejection')
  for (let listener of origin) process.on('unhandledRejection', listener)

  expect(reasons).toEqual(['error'])
  expect(unhandled).toEqual([])
})

it('reports the migration, which was interrupted by the closed tab', async () => {
  let { client, db } = await setup()
  // The tab was closed between the drop of the tables and the end
  // of the replay
  localStorage.setItem('logux:db:migrating', '1')

  let reasons: CrdtCorruption[] = []
  let crdt = createCrdtDatabase(client, db)
  crdt.on('corrupted', reason => {
    reasons.push(reason)
  })
  crdt.table('user', USER_SCHEMA)
  await crdt.ready

  expect(reasons).toEqual(['interrupted-migration'])
  expect(localStorage.getItem('logux:db:migrating')).toBeNull()

  crdt.destroy()
})

it('cleans the migration flag after the replay', async () => {
  let { client, db } = await setup()
  localStorage.setItem('logux:db', '{}')
  await client.log.add(
    { fields: { name: 'Ann' }, id: 'U1', type: 'user/created' },
    { reasons: ['test'] }
  )

  let flags: (null | string)[] = []
  let crdt = createCrdtDatabase(client, db)
  crdt.on('migrating', () => {
    flags.push(localStorage.getItem('logux:db:migrating'))
  })
  crdt.table('user', USER_SCHEMA)
  await crdt.ready

  expect(flags).toEqual([null])
  expect(localStorage.getItem('logux:db:migrating')).toBeNull()

  crdt.destroy()
})

it('reports the tables, which were emptied not by the actions', async () => {
  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  let user1 = crdt1.table('user', USER_SCHEMA)
  await crdt1.ready
  await user1.create({ name: 'Ann' })
  await delay(10)
  expect(localStorage.getItem('logux:db:filled')).toBe('1')
  crdt1.destroy()

  // The browser dropped the data of the origin, but kept `localStorage`
  await db.driver.exec('DELETE FROM "user"', [])

  let reasons: CrdtCorruption[] = []
  let crdt2 = createCrdtDatabase(client, db)
  crdt2.on('corrupted', reason => {
    reasons.push(reason)
  })
  crdt2.table('user', USER_SCHEMA)
  await crdt2.ready

  expect(reasons).toEqual(['empty-tables'])
  expect(localStorage.getItem('logux:db:filled')).toBeNull()

  crdt2.destroy()
})

it('does not report the tables, which the user emptied', async () => {
  let { client, db } = await setup()
  let reasons: CrdtCorruption[] = []
  let crdt1 = createCrdtDatabase(client, db)
  crdt1.on('corrupted', reason => {
    reasons.push(reason)
  })
  let user1 = crdt1.table('user', USER_SCHEMA)
  await crdt1.ready
  let id = await user1.create({ name: 'Ann' })
  await delay(10)
  await user1.delete(id)
  await delay(10)
  expect(localStorage.getItem('logux:db:filled')).toBeNull()
  // The deleting action emptied the tables, not the data loss
  expect(reasons).toEqual([])
  crdt1.destroy()

  let crdt2 = createCrdtDatabase(client, db)
  crdt2.on('corrupted', reason => {
    reasons.push(reason)
  })
  crdt2.table('user', USER_SCHEMA)
  await crdt2.ready
  await delay(10)

  expect(reasons).toEqual([])

  crdt2.destroy()
})

it('does not report the tables, which were cleaned with the client', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await crdt.ready
  await user.create({ name: 'Ann' })
  await delay(10)

  await crdt.empty()
  expect(localStorage.getItem('logux:db:filled')).toBeNull()

  crdt.destroy()
})
