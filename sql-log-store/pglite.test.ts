import { eachStoreCheck, type Meta, toSorted } from '@logux/core'
import { openDb } from '@nanostores/sql'
import { pgliteDriver } from '@nanostores/sql/pglite'
import { afterAll, beforeEach, expect, it } from 'vitest'

import { SqlLogStore } from '../db.js'

let db = openDb(pgliteDriver('memory://'))

beforeEach(async () => {
  // All tests share a single PGlite instance, since starting it is slow
  await db.exec`DROP TABLE IF EXISTS "logux_log", "logux_reason",
    "logux_index", "logux_extra", "logux_version"`
}, 60000)

afterAll(async () => {
  await db.close()
})

eachStoreCheck((desc, creator) => {
  it(
    desc,
    { timeout: 60000 },
    creator(() => new SqlLogStore(db))
  )
})

it('keeps big numbers', { timeout: 60000 }, async () => {
  let store = new SqlLogStore(db)
  await store.add({ type: 'A' }, {
    id: 'OersMw- 10:client:uuid',
    time: 1764021600000
  } as Meta)
  await store.setLastSynced({ received: 1, sent: 2 })

  expect(await store.getLastAdded()).toBe(1)
  expect(await store.getLastSynced()).toEqual({ received: 1, sent: 2 })
  let page = await store.get({ order: 'created' })
  expect(page.entries).toEqual([
    [
      { type: 'A' },
      {
        added: 1,
        id: 'OersMw- 10:client:uuid',
        time: 1764021600000
      }
    ]
  ])
})

it('loads log by pages', { timeout: 60000 }, async () => {
  let store = new SqlLogStore(db)
  await store.getLastAdded()

  let rows = []
  let params = []
  for (let i = 1; i <= 1001; i++) {
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

  for (let order of ['added', 'created'] as const) {
    let page = await store.get({ order })
    expect(page.entries).toHaveLength(1000)
    expect(page.entries[999]![0]).toEqual({ type: 'A1001' })
    expect(page.entries[0]![0]).toEqual({ type: 'A2' })

    let last = await page.next!()
    expect(last.entries).toEqual([
      [{ type: 'A1' }, { added: 1, id: '1 10:1', time: 1 }]
    ])
    expect(last.next).toBeUndefined()
  }
})
