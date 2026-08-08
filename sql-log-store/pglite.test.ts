import { eachStoreCheck, type Meta } from '@logux/core'
import { openDb } from '@nanostores/sql'
import { pgliteDriver } from '@nanostores/sql/pglite'
import { afterAll, beforeEach, expect, it } from 'vitest'

import { SqlLogStore } from '../db.js'

let db = openDb(pgliteDriver('memory://'))

beforeEach(async () => {
  // All tests share a single PGlite instance, since starting it is slow
  await db.exec`DROP TABLE IF EXISTS "logux_log", "logux_reason",
    "logux_index", "logux_extra", "logux_version"`
})

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
    id: '1764021600000 10:client:uuid 0',
    time: 1764021600000
  } as Meta)
  await store.setLastSynced({ received: 1, sent: 2 })

  expect(await store.getLastAdded()).toBe(1)
  expect(await store.getLastSynced()).toEqual({ received: 1, sent: 2 })
  let page = await store.get({ order: 'created' })
  expect(page.entries).toEqual([
    [
      { type: 'A' },
      { added: 1, id: '1764021600000 10:client:uuid 0', time: 1764021600000 }
    ]
  ])
})
