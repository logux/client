import type { Database } from '@nanostores/sql'

import { Client } from '../index.js'
import {
  bigint,
  boolean,
  createCrdtDatabase,
  defineCrdtTable,
  json,
  number,
  oneOf,
  optional,
  parseCrdtRows,
  string,
  withoutMeta
} from './index.js'

let client = new Client({
  server: 'ws://localhost',
  subprotocol: 10,
  userId: '10'
})

declare let db: Database

let crdt = createCrdtDatabase(client, db)

let user = crdt.table('user', {
  age: optional(number()),
  createdAt: bigint({ default: () => Date.now() }),
  name: string(),
  role: oneOf(['admin', 'user'])
})

async function test(): Promise<void> {
  // THROWS No overload matches this call.
  await user.create({ age: 30 })
  // THROWS No overload matches this call.
  await user.create({ name: 5, role: 'user' })
  // THROWS No overload matches this call.
  await user.create({ name: 'Ann', role: 'guest' })
  // THROWS No overload matches this call.
  await user.create([{ age: 30 }])
  // THROWS No overload matches this call.
  await user.create({ name: null, role: 'user' })
  // THROWS No overload matches this call.
  await user.create({ createdAt: null, name: 'Ann', role: 'user' })
  // THROWS Type 'string' is not assignable to type 'number'.
  await user.update(['id'], { createdAt: '2026-01-01' })
  // THROWS Type 'number' is not assignable to type 'string'.
  await user.delete([1])
  // THROWS Type 'string' is not assignable to type 'number'.
  await user.update('id', { createdAt: '2026-01-01' })
  // THROWS Object literal may only specify known properties
  await user.update('id', { unknown: 1 })

  let all = user.select().get()
  if (all.status === 'ready') {
    // THROWS Property 'updatedAt' does not exist
    console.log(all.value[0]!.updatedAt)
    // THROWS Property 'updatedAt_missing' does not exist
    console.log(all.value[0]!.updatedAt_missing)
    // THROWS Property 'updatedAt_name' does not exist
    console.log(withoutMeta(all.value)[0]!.updatedAt_name)
  }

  let $stats = db.store<{ total: number }>`
    SELECT COUNT(*) AS "total" FROM "user"
  `
  let stats = $stats.get()
  if (stats.status === 'ready') {
    // THROWS Type 'number' is not assignable to type 'string'.
    let total: string = stats.value[0]!.total
    // THROWS Property 'missing' does not exist
    console.log(total, stats.value[0]!.missing)
  }

  // THROWS Argument of type '{}' is not assignable to parameter
  user.select`WHERE "age" = ${{}}`
  // THROWS Argument of type 'boolean' is not assignable to parameter
  user.select`WHERE "age" = ${true}`
  // THROWS Argument of type 'Date' is not assignable to parameter
  user.select`WHERE "createdAt" > ${new Date()}`

  // THROWS No overload matches this call.
  await note.create({ tags: ['a'] })
  // THROWS No overload matches this call.
  await note.create({ meta: { views: '1' }, tags: [] })
  // THROWS No overload matches this call.
  await note.create({ meta: { views: 1 }, tags: [1] })
  // THROWS No overload matches this call.
  await note.create({ meta: { views: 1, extra: 1 }, tags: [] })
  // THROWS Type 'number' is not assignable to type 'string'.
  await note.update('id', { tags: [1] })
  // THROWS Type 'null' is not assignable to type
  await note.update('id', { meta: null })
  // THROWS Object literal may only specify known properties
  await note.update('id', { meta: { extra: 1, views: 1 } })
  // THROWS Type '"big"' is not assignable to type
  await note.update('id', { meta: { size: 'big', views: 1 } })

  let notes = note.select().get()
  if (notes.status === 'ready') {
    // THROWS Type 'number' is not assignable to type 'string'.
    let views: string = notes.value[0]!.meta.views
    // THROWS Property 'extra' does not exist
    console.log(views, notes.value[0]!.meta.extra)
    // THROWS Type '"medium" | "small" | null | undefined' is not assignable
    let size: 'medium' | 'small' = notes.value[0]!.meta.size
    console.log(size)
    // THROWS Type 'number | null | undefined' is not assignable to type 'n
    let score: number | undefined = notes.value[0]!.scores[0]
    console.log(score)
  }
}

let note = crdt.table('note', {
  meta: json({
    size: optional(oneOf(['medium', 'small'])),
    views: number()
  }),
  scores: json([optional(number())]),
  tags: json([string()])
})

let badDefault = { default: { views: '1' } }
// THROWS No overload matches this call.
crdt.table('badDefault', { meta: json({ views: number() }, badDefault) })

// THROWS No overload matches this call.
crdt.table('bad', { isAdmin: boolean({ default: false }) })

// THROWS Type '"missing"' is not assignable to type
crdt.table('post', { title: string() }, ['missing'])
// THROWS Type '"updatedAt_missing"' is not assignable to type
crdt.table('post', { title: string() }, [['title', 'updatedAt_missing']])
// THROWS Object literal may only specify known properties
crdt.table('post', { title: string() }, [{ columns: ['title'], where: '1' }])

let pg = createCrdtDatabase(client, db, { dialect: 'pglite' })
let pgUser = pg.table('user', {
  isAdmin: boolean({ default: false }),
  name: string()
})

let pgValue = pgUser.select().get()
if (pgValue.status === 'ready') {
  // THROWS Type 'boolean' is not assignable to type 'number'.
  let isAdmin: number = pgValue.value[0]!.isAdmin
  console.log(isAdmin)
}

test()

let definedFeeds = defineCrdtTable('feeds', { title: string() })
// THROWS Object literal may only specify known properties
definedFeeds.created({ fields: { title: 'A', unknown: 1 }, id: 'F1' })
for (let [, fields] of parseCrdtRows(
  definedFeeds.created({ fields: { title: 'A' }, id: 'F1' })
)) {
  // THROWS Cannot assign to 'title' because it is a read-only property
  fields.title = 'B'
}
// THROWS Argument of type 'CrdtTableDefinition<{ isAdmin: { type: "BOOLEAN"
crdt.table(defineCrdtTable('flags', { isAdmin: boolean({ default: false }) }))

let whereFeeds = crdt.table(defineCrdtTable('whereFeeds', { title: string() }))
async function where(): Promise<void> {
  // THROWS Object literal may only specify known properties
  await whereFeeds.updateWhere({ unknown: 1 })()
  // THROWS not assignable to parameter of type 'CrdtSqlParam<"sqlite">'
  await whereFeeds.deleteWhere`"title" = ${true}`
}
where()
