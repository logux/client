import type { Database } from '@nanostores/sql'

import { Client } from '../index.js'
import {
  createCrdtDatabase,
  date,
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
  createdAt: date({ default: () => new Date() }),
  name: string(),
  role: oneOf(['admin', 'user'])
})

async function test(): Promise<void> {
  // THROWS Argument of type '{ age: number; }' is not assignable to parameter
  await user.create({ age: 30 })
  // THROWS Type 'number' is not assignable to type 'string'.
  await user.create({ name: 5, role: 'user' })
  // THROWS Type '"guest"' is not assignable to type
  await user.create({ name: 'Ann', role: 'guest' })
  // THROWS Type 'string' is not assignable to type 'Date'.
  await user.update('id', { createdAt: '2026-01-01' })
  // THROWS Object literal may only specify known properties
  await user.update('id', { unknown: 1 })

  let $stats = crdt.sql<{ total: number }>`
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
}

test()
