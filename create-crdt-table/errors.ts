import type { Database } from '@nanostores/sql'

import { Client } from '../index.js'
import {
  bigint,
  boolean,
  createCrdtDatabase,
  number,
  oneOf,
  optional,
  string
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
  // THROWS Type 'string' is not assignable to type 'number'.
  await user.update(['id'], { createdAt: '2026-01-01' })
  // THROWS Type 'number' is not assignable to type 'string'.
  await user.delete([1])
  // THROWS Type 'string' is not assignable to type 'number'.
  await user.update('id', { createdAt: '2026-01-01' })
  // THROWS Object literal may only specify known properties
  await user.update('id', { unknown: 1 })

  let all = user.select().get()
  if (!all.isLoading) {
    // THROWS Property 'updatedAt' does not exist
    console.log(all.value[0]!.updatedAt)
    // THROWS Property 'updatedAt_missing' does not exist
    console.log(all.value[0]!.updatedAt_missing)
  }

  let $stats = db.store<{ total: number }>`
    SELECT COUNT(*) AS "total" FROM "user"
  `
  let stats = $stats.get()
  if (!stats.isLoading) {
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
}

// THROWS type: "BOOLEAN"; } & CrdtColumn<boolean, false>' is not assignable
crdt.table('bad', { isAdmin: boolean({ default: false }) })

let pg = createCrdtDatabase(client, db, { dialect: 'pglite' })
let pgUser = pg.table('user', {
  isAdmin: boolean({ default: false }),
  name: string()
})

let pgValue = pgUser.select().get()
if (!pgValue.isLoading) {
  // THROWS Type 'boolean' is not assignable to type 'number'.
  let isAdmin: number = pgValue.value[0]!.isAdmin
  console.log(isAdmin)
}

test()
