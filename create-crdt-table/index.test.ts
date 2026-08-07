import type { Action } from '@logux/core'
import type { Database, Driver, SqlStore } from '@nanostores/sql'
import { openDb } from '@nanostores/sql'
import { nodeDriver } from '@nanostores/sql/node'
import { delay } from 'nanodelay'
import { cleanStores } from 'nanostores'
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest'

import { type ClientMeta, loadValue, TestClient } from '../index.js'
import { setLocalStorage } from '../test/local-storage.js'
import {
  bigint,
  boolean,
  createCrdtDatabase,
  number,
  oneOf,
  optional,
  string
} from './index.js'

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

function manualLocks(): {
  callbacks: (() => Promise<unknown>)[]
  names: string[]
} {
  let callbacks: (() => Promise<unknown>)[] = []
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
        callbacks.push(callback)
        return new Promise((resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new Error('AbortError'))
          })
        })
      }
    }
  })
  return { callbacks, names }
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
  expect(JSON.parse(rows[0]!.updatedAt).name).toBeTypeOf('string')
  expect(JSON.parse(rows[0]!.updatedAt).age).toBeUndefined()

  await user.update(id, { age: 30, isAdmin: 1 })
  await delay(10)
  let updated = await loadList($all)
  expect(updated[0]!.age).toBe(30)
  expect(updated[0]!.isAdmin).toBe(1)
  expect(updated[0]!.name).toBe('Ann')
  expect(JSON.parse(updated[0]!.updatedAt).age).toBeTypeOf('string')

  await user.update(id, { age: null, name: undefined })
  await delay(10)
  expect((await loadList($all))[0]!.age).toBeNull()
  expect((await loadList($all))[0]!.name).toBe('Ann')

  await user.delete(id)
  await delay(10)
  expect(await loadList($all)).toEqual([])

  cleanStores($all)
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
    { id: '10 10:other 0', time: 10 }
  )
  await delay(10)

  await client.log.add(
    { fields: { name: 'New' }, id: 'U1', type: 'user/changed' },
    { id: '100 10:other 0', time: 100 }
  )
  await delay(10)

  await client.log.add(
    { fields: { age: 20, name: 'Old' }, id: 'U1', type: 'user/changed' },
    { id: '50 10:other 0', time: 50 }
  )
  await delay(10)

  let rows = await loadList(user.select())
  expect(rows).toHaveLength(1)
  expect(rows[0]!.name).toBe('New')
  expect(rows[0]!.age).toBe(20)
  expect(rows[0]!.role).toBe('admin')
  let updatedAt = JSON.parse(rows[0]!.updatedAt)
  expect(updatedAt.name).toBe('100 10:other 0')
  expect(updatedAt.age).toBe('50 10:other 0')

  await client.log.add(
    { fields: { name: 'New' }, id: 'U1', type: 'user/changed' },
    { id: '100 10:other 0', time: 100 }
  )
  await delay(10)
  let same = await loadList(user.select())
  expect(same[0]!.name).toBe('New')
  expect(JSON.parse(same[0]!.updatedAt).name).toBe('100 10:other 0')
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
    { id: '200 10:other 0', time: 200 }
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
  localStorage.setItem('logux:db', JSON.stringify({ removed: {}, user: {} }))
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
      { added: 0, id: '10 10:other 0', reasons: [], time: 10 }
    ]
  ]

  let migratings: Promise<void>[] = []
  let crdt = createCrdtDatabase(client, db, {
    migrating(done) {
      migratings.push(done)
    },
    repeat: () => entries
  })
  let user = crdt.table('user', USER_SCHEMA)
  let statuses: string[] = []
  crdt.status.subscribe(state => {
    statuses.push(state)
  })
  await delay(10)
  expect(statuses).toEqual(['initializing', 'migrating', 'ready'])
  expect(migratings).toEqual([crdt.ready])
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

it('resolves ready promise on ready and on outdated', async () => {
  let { client, db } = await setup()
  let migratingCalled = 0
  let crdt = createCrdtDatabase(client, db, {
    migrating() {
      migratingCalled += 1
    }
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
    transaction() {
      throw new Error('Unsupported')
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
  let crdt = createCrdtDatabase(client, db, {
    stop() {
      stopCalled += 1
    }
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

it('applies actions only in the leader tab', async () => {
  let { callbacks: lockCallbacks, names: lockNames } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)
  expect(crdt.status.get()).toBe('ready')
  expect(lockNames).toEqual(['logux:db:lock'])

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect(await loadList(user.select())).toEqual([])

  let lockReleased = false
  void lockCallbacks[0]!().then(() => {
    lockReleased = true
  })
  await delay(10)

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect((await loadList(user.select())).map(i => i.id)).toEqual(['U1'])
  expect(lockReleased).toBe(false)

  emitStorage('logux:db', 'newer-hash')
  await delay(10)
  expect(lockReleased).toBe(true)
})

it('does not become leader when lock is granted after outdate', async () => {
  let { callbacks: lockCallbacks } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA)
  await delay(10)

  emitStorage('logux:db', 'newer-hash')
  expect(crdt.status.get()).toBe('outdated')
  await lockCallbacks[0]!()
})

it('unsubscribes from the log and from other tabs on destroy()', async () => {
  let { client, db } = await setup()
  let stopCalled = 0
  let crdt = createCrdtDatabase(client, db, {
    stop() {
      stopCalled += 1
    }
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

it('passes the leader lock to the next database after destroy()', async () => {
  queuedLocks()

  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  crdt1.table('user', USER_SCHEMA)
  await delay(10)

  let client2 = new TestClient('10')
  await client2.connect()
  let db2 = openDb(nodeDriver(':memory:'))
  let crdt2 = createCrdtDatabase(client2, db2)
  let user2 = crdt2.table('user', USER_SCHEMA)
  await delay(10)
  expect(crdt2.status.get()).toBe('ready')

  await client2.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect(await loadList(user2.select())).toEqual([])

  crdt1.destroy()
  await delay(10)

  await client2.log.add({
    fields: { name: 'Ben' },
    id: 'U2',
    type: 'user/created'
  })
  await delay(10)
  expect((await loadList(user2.select())).map(i => i.id)).toEqual(['U2'])
})

it('cancels not granted lock request on destroy()', async () => {
  queuedLocks()

  let { client, db } = await setup()
  let crdt1 = createCrdtDatabase(client, db)
  crdt1.table('user', USER_SCHEMA)
  await delay(10)

  let client2 = new TestClient('10')
  await client2.connect()
  let db2 = openDb(nodeDriver(':memory:'))
  let crdt2 = createCrdtDatabase(client2, db2)
  let user2 = crdt2.table('user', USER_SCHEMA)
  crdt2.destroy()
  await delay(10)

  crdt1.destroy()
  await delay(10)

  await client2.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
  await delay(10)
  expect(await loadList(user2.select())).toEqual([])
})

it('does not become leader when lock is granted after destroy()', async () => {
  let { callbacks: lockCallbacks } = manualLocks()

  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  let user = crdt.table('user', USER_SCHEMA)
  await delay(10)

  crdt.destroy()
  await lockCallbacks[0]!()

  await client.log.add({
    fields: { name: 'Ann' },
    id: 'U1',
    type: 'user/created'
  })
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
    transaction() {
      throw new Error('Unsupported')
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
      '"updatedAt" TEXT)'
  ])
})

it('allows to replace localStorage key for third-party widgets', async () => {
  let { client, db } = await setup()
  let stopCalled = 0
  let crdt = createCrdtDatabase(client, db, {
    key: 'widget:db',
    stop() {
      stopCalled += 1
    }
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
  expect(JSON.parse(rows[0]!.updatedAt).name).toBeTypeOf('string')
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

it('throws on table() call after initialization', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  crdt.table('user', USER_SCHEMA)
  await delay(10)

  expect(() => {
    crdt.table('post', { title: string() })
  }).toThrow(/sync/)
})

it('throws on column type unsupported by dialect', async () => {
  let { client, db } = await setup()
  let crdt = createCrdtDatabase(client, db)
  expect(() => {
    // @ts-expect-error
    crdt.table('user', { isAdmin: boolean() })
  }).toThrow('sqlite does not support boolean')
})
