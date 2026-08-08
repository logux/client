import {
  type Action,
  eachStoreCheck,
  type LogPage,
  type Meta
} from '@logux/core'
import type { Database } from '@nanostores/sql'
import { openDb } from '@nanostores/sql'
import { nodeDriver } from '@nanostores/sql/node'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { SqlLogStore } from '../db.js'

type Entry = [Action, Meta]

let db: Database

beforeEach(() => {
  db = openDb(nodeDriver(':memory:'))
})

afterEach(async () => {
  await db.close()
})

async function all(request: Promise<LogPage>): Promise<Entry[]> {
  let page = await request
  return page.entries
}

async function versions(): Promise<{ version: number }[]> {
  return db.select`SELECT * FROM "logux_version"`
}

eachStoreCheck((desc, creator) => {
  it(
    desc,
    creator(() => new SqlLogStore(db))
  )
})

it('creates tables only once', async () => {
  let store = new SqlLogStore(db)
  await Promise.all([store.getLastAdded(), store.getLastAdded()])
  await store.add({ type: 'A' }, { id: '1 n 0', time: 1 } as Meta)

  let tables = await db.select<{
    name: string
  }>`SELECT "name" FROM sqlite_master WHERE "type" = 'table' ORDER BY "name"`
  expect(tables.map(i => i.name)).toEqual([
    'logux_extra',
    'logux_index',
    'logux_log',
    'logux_reason',
    'logux_version'
  ])
})

it('keeps the log on the same tables version', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, { id: '1 n 0', time: 1 } as Meta)

  let next = new SqlLogStore(db)
  expect(await all(next.get())).toEqual([
    [{ type: 'A' }, { added: 1, id: '1 n 0', time: 1 }]
  ])
  expect(await versions()).toEqual([{ version: 1 }])
})

it('re-creates the log on tables version change', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, {
    id: '1 n 0',
    indexes: ['a'],
    reasons: ['test'],
    time: 1
  } as Meta)
  await store.setLastSynced({ received: 1, sent: 2 })

  await db.exec`UPDATE "logux_version" SET "version" = ${0}`
  let next = new SqlLogStore(db)
  expect(await all(next.get())).toEqual([])
  expect(await all(next.get({ index: 'a' }))).toEqual([])
  expect(await next.getLastAdded()).toBe(0)
  expect(await next.getLastSynced()).toEqual({ received: 0, sent: 0 })
  expect(await versions()).toEqual([{ version: 1 }])

  await next.add({ type: 'B' }, { id: '2 n 0', time: 2 } as Meta)
  expect(await all(next.get())).toEqual([
    [{ type: 'B' }, { added: 1, id: '2 n 0', time: 2 }]
  ])
})

it('does not work with the log from a newer client', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, { id: '1 n 0', time: 1 } as Meta)
  await db.exec`UPDATE "logux_version" SET "version" = ${2}`

  let next = new SqlLogStore(db)
  await expect(next.get()).rejects.toThrow(
    'DB was created by a newer version of Logux Client'
  )
  await expect(next.getLastAdded()).rejects.toThrow(/newer version/)

  expect(await versions()).toEqual([{ version: 2 }])
  expect(await all(store.get())).toEqual([
    [{ type: 'A' }, { added: 1, id: '1 n 0', time: 1 }]
  ])
})

it('ignores unknown parts of action ID', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, { id: 'unknown', time: 1 } as Meta)
  await store.add({ type: 'B' }, { id: '2 n 0', time: 1 } as Meta)

  expect(await all(store.get({ order: 'created' }))).toEqual([
    [{ type: 'A' }, { added: 1, id: 'unknown', time: 1 }],
    [{ type: 'B' }, { added: 2, id: '2 n 0', time: 1 }]
  ])
})

it('keeps the queue alive after error', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, { id: '1 n 0', time: 1 } as Meta)
  await db.exec`DROP TABLE "logux_reason"`

  let error: Error | undefined
  try {
    await store.add({ type: 'B' }, {
      id: '2 n 0',
      reasons: ['test'],
      time: 2
    } as Meta)
  } catch (e) {
    error = e as Error
  }
  expect(error).toBeDefined()

  expect(await store.getLastAdded()).toBe(1)
})

it('does not lose Uint8Array in meta', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, {
    id: '1 n 0',
    iv: new Uint8Array([1, 2, 3]),
    time: 1
  } as unknown as Meta)

  let [, meta] = await store.byId('1 n 0')
  expect(meta!.iv).toEqual(new Uint8Array([1, 2, 3]))
})
