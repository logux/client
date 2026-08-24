import {
  type Action,
  eachStoreCheck,
  Log,
  type LogPage,
  type Meta,
  toSorted
} from '@logux/core'
import type { Database } from '@nanostores/sql'
import { openDb } from '@nanostores/sql'
import { nodeDriver } from '@nanostores/sql/node'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { SqlLogStore } from '../db.js'

type Entry = [Action, Meta]

let db: Database

beforeEach(() => {
  db = openDb(nodeDriver(':memory:'))
  // Disabling error output since we will test error handling
  db.on('error', () => {})
})

afterEach(async () => {
  await db.close()
})

async function versions(): Promise<{ version: number }[]> {
  return db.select`SELECT * FROM "logux_version"`
}

async function all(request: Promise<LogPage>): Promise<Entry[]> {
  let page = await request
  let entries = page.entries
  while (page.next) {
    page = await page.next()
    entries = page.entries.concat(entries)
  }
  return entries
}

/**
 * Add actions by raw SQL, since 10 000 `add()` calls are too slow for tests.
 */
async function fill(count: number): Promise<void> {
  for (let start = 1; start <= count; start += 1000) {
    let rows = []
    let params = []
    for (let i = start; i < start + 1000 && i <= count; i++) {
      let id = `${i} 10:1`
      rows.push(`(${Array(5).fill('?').join(', ')})`)
      params.push(
        i,
        id,
        toSorted({ id, time: i }),
        JSON.stringify({ type: `A${i}` }),
        JSON.stringify({ added: i, id, time: i })
      )
    }
    await db.driver.exec(
      `INSERT INTO "logux_log" ("added", "id", "sorted",` +
        ` "action", "meta") VALUES ${rows.join(', ')}`,
      params
    )
  }
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
  await store.add({ type: 'A' }, { id: '0 n', time: 1 } as Meta)

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
  await store.add({ type: 'A' }, { id: '0 n', time: 1 } as Meta)

  let next = new SqlLogStore(db)
  expect(await all(next.get())).toEqual([
    [{ type: 'A' }, { added: 1, id: '0 n', time: 1 }]
  ])
  expect(await versions()).toEqual([{ version: 1 }])
})

it('writes new tables version without losing the log', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, {
    id: '0 n',
    indexes: ['a'],
    reasons: ['test'],
    time: 1
  } as Meta)
  await store.setLastSynced({ received: 1, sent: 2 })

  await db.exec`UPDATE "logux_version" SET "version" = ${0}`
  let next = new SqlLogStore(db)
  expect(await all(next.get())).toHaveLength(1)
  expect(await next.getLastAdded()).toBe(1)
  expect(await next.getLastSynced()).toEqual({ received: 1, sent: 2 })
  expect(await versions()).toEqual([{ version: 1 }])
})
it('does not work with the log from a newer client', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, { id: '0 n', time: 1 } as Meta)
  await db.exec`UPDATE "logux_version" SET "version" = ${2}`

  let next = new SqlLogStore(db)
  await expect(next.get()).rejects.toThrow('Log from a newer Logux Client')
  await expect(next.getLastAdded()).rejects.toThrow(/newer Logux Client/)
  // The applier reads the name to stop the tab instead of resetting the data
  let thrown = await next.getLastAdded().catch((e: Error) => e)
  expect(thrown).toBeInstanceOf(Error)
  expect((thrown as Error).name).toBe('LoguxNewerDatabase')

  expect(await versions()).toEqual([{ version: 2 }])
  expect(await all(store.get())).toEqual([
    [{ type: 'A' }, { added: 1, id: '0 n', time: 1 }]
  ])
})

it('ignores unknown parts of action ID', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, { id: 'unknown', time: 1 } as Meta)
  await store.add({ type: 'B' }, { id: '1 n', time: 2 } as Meta)

  expect(await all(store.get({ order: 'created' }))).toEqual([
    [{ type: 'A' }, { added: 1, id: 'unknown', time: 1 }],
    [{ type: 'B' }, { added: 2, id: '1 n', time: 2 }]
  ])
})

it('keeps the queue alive after error', async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, { id: '0 n', time: 1 } as Meta)
  await db.exec`DROP TABLE "logux_reason"`

  let error: Error | undefined
  try {
    await store.add({ type: 'B' }, {
      id: '1 n',
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
    id: '0 n',
    iv: new Uint8Array([1, 2, 3]),
    time: 1
  } as unknown as Meta)

  let [, meta] = await store.byId('0 n')
  expect(meta!.iv).toEqual(new Uint8Array([1, 2, 3]))
})

it('loads a big log by pages', { timeout: 30000 }, async () => {
  let store = new SqlLogStore(db)
  await store.getLastAdded()
  await fill(10000)

  let sizes: number[] = []
  let page = await store.get({ order: 'created' })
  sizes.push(page.entries.length)
  while (page.next) {
    page = await page.next()
    sizes.push(page.entries.length)
  }
  // The last page is full, so the store offers to load one more
  expect(sizes).toEqual([...Array(10).fill(1000), 0])

  let log = new Log({ nodeId: '10:1', store })
  let visited: string[] = []
  await log.each(action => {
    visited.push(action.type)
  })
  expect(visited).toHaveLength(10000)
  expect(visited[0]).toBe('A10000')
  expect(visited[9999]).toBe('A1')

  let stopped: string[] = []
  await log.each(action => {
    stopped.push(action.type)
    return stopped.length < 3
  })
  expect(stopped).toEqual(['A10000', 'A9999', 'A9998'])
})

it('gives different added on parallel adds to the same file', async () => {
  let dir = await mkdtemp(join(tmpdir(), 'logux-'))
  let file = join(dir, 'test.sqlite')
  let db1 = openDb(nodeDriver(file))
  let db2 = openDb(nodeDriver(file))
  let store1 = new SqlLogStore(db1)
  let store2 = new SqlLogStore(db2)
  await store1.getLastAdded()
  await store2.getLastAdded()

  let [meta1, meta2] = await Promise.all([
    store1.add({ type: 'A' }, { id: '0 n', time: 1 } as Meta),
    store2.add({ type: 'B' }, { id: '1 n', time: 2 } as Meta)
  ])
  let added = [(meta1 as Meta).added, (meta2 as Meta).added]
  expect(added.sort((a, b) => a - b)).toEqual([1, 2])
  expect(await store1.getLastAdded()).toBe(2)
  let types = (await all(store1.get())).map(i => i[0].type)
  expect(types.sort()).toEqual(['A', 'B'])

  await db1.close()
  await db2.close()
  await rm(dir, { force: true, recursive: true })
})
