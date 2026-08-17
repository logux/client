import type { SqlStore } from '@nanostores/sql'
import { openDb } from '@nanostores/sql'
import { pgliteDriver } from '@nanostores/sql/pglite'
import { delay } from 'nanodelay'
import { beforeAll, beforeEach, expect, it } from 'vitest'

import { loadValue, TestClient } from '../index.js'
import { setLocalStorage } from '../test/local-storage.js'
import {
  bigint,
  boolean,
  createCrdtDatabase,
  optional,
  string
} from './index.js'

beforeAll(() => {
  setLocalStorage()
})

beforeEach(() => {
  localStorage.clear()
})

async function loadList<Row>(store: SqlStore<Row[]>): Promise<Row[]> {
  let value = await loadValue(store)
  return value.value
}

it('uses real BOOLEAN columns in PGlite', { timeout: 60000 }, async () => {
  let client = new TestClient('10')
  await client.connect()
  let db = openDb(pgliteDriver('memory://'))
  let crdt = createCrdtDatabase(client, db, { dialect: 'pglite' })
  let user = crdt.table(
    'user',
    {
      createdAt: bigint({ default: () => new Date(2026, 0, 1).getTime() }),
      isAdmin: boolean({ default: false }),
      name: string(),
      publishedAt: optional(bigint())
    },
    [
      'name',
      ['isAdmin', 'createdAt DESC'],
      { columns: ['createdAt', 'name'], unique: true },
      {
        sql:
          'CREATE INDEX IF NOT EXISTS "user_published" ON "user"' +
          ' ("publishedAt" DESC NULLS LAST) WHERE "publishedAt" IS NOT NULL'
      }
    ]
  )

  await crdt.ready

  let indexes = (await db.driver.select(
    'SELECT "indexname" FROM "pg_indexes"' +
      ' WHERE "tablename" = $1 ORDER BY "indexname"',
    ['user']
  )) as { indexname: string }[]
  expect(indexes.map(i => i.indexname)).toEqual([
    'user_createdAt_name',
    'user_isAdmin_createdAt',
    'user_name',
    'user_pkey',
    'user_published'
  ])

  await user.create({
    id: 'U1',
    isAdmin: true,
    name: 'Ann',
    publishedAt: 3000
  })
  await user.create({ id: 'U2', name: 'Ben' })
  await delay(100)

  let rows = await loadList(user.select`ORDER BY "id"`)
  expect(rows.map(i => i.id)).toEqual(['U1', 'U2'])
  expect(rows[0]!.isAdmin).toBe(true)
  expect(rows[1]!.isAdmin).toBe(false)
  expect(rows[0]!.createdAt).toBe(new Date(2026, 0, 1).getTime())
  expect(rows[0]!.publishedAt).toBe(3000)
  expect(rows[1]!.publishedAt).toBeNull()

  let admins = await loadList(user.select`WHERE "isAdmin" = ${true}`)
  expect(admins.map(i => i.id)).toEqual(['U1'])

  let late = await loadList(user.select`WHERE "publishedAt" > ${2000}`)
  expect(late.map(i => i.id)).toEqual(['U1'])

  await user.update('U1', { isAdmin: false, publishedAt: 5000 })
  await delay(100)
  let updated = await loadList(user.select`WHERE "id" = ${'U1'}`)
  expect(updated[0]!.isAdmin).toBe(false)
  expect(updated[0]!.publishedAt).toBe(5000)

  await user.delete('U2')
  await delay(100)
  expect((await loadList(user.select())).map(i => i.id)).toEqual(['U1'])

  await user.create([
    { id: 'U3', name: 'Cat' },
    { id: 'U4', name: 'Dan', publishedAt: 7000 }
  ])
  await delay(100)
  let created = await loadList(user.select`ORDER BY "id"`)
  expect(created.map(i => i.id)).toEqual(['U1', 'U3', 'U4'])
  expect(created.map(i => i.isAdmin)).toEqual([false, false, false])
  expect(created.map(i => i.publishedAt)).toEqual([5000, null, 7000])

  await user.update(['U3', 'U4'], { isAdmin: true })
  await delay(100)
  let batchAdmins = await loadList(user.select`WHERE "isAdmin" = ${true}`)
  expect(batchAdmins.map(i => i.id)).toEqual(['U3', 'U4'])

  await user.delete(['U3', 'U4'])
  await delay(100)
  expect((await loadList(user.select())).map(i => i.id)).toEqual(['U1'])

  await db.close()
})
