import { defineCrdtTableActions } from '@logux/actions'
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

let crdt = createCrdtDatabase(client, db, {
  dialect: 'sqlite',
  key: 'widget:db',
  migrating(done) {
    void done.then(() => {})
  },
  repeat() {
    return []
  },
  stop() {}
})

let user = crdt.table('user', {
  age: optional(number()),
  createdAt: bigint({ default: () => Date.now() }),
  email: string('COLLATE NOCASE'),
  isAdmin: number({ default: 0 }),
  name: string(),
  publishedAt: optional(bigint()),
  role: oneOf(['admin', 'guest', 'user'], { default: 'user' }),
  theme: string<'dark' | 'light'>({ default: 'dark' })
})

async function test(): Promise<void> {
  await crdt.ready
  let status: 'initializing' | 'migrating' | 'outdated' | 'ready' =
    crdt.status.get()
  console.log(status)

  let id: string = await user.create({ email: 'a@b.c', name: 'Ann' })
  await user.create({
    age: 30,
    createdAt: Date.now(),
    email: 'a@b.c',
    isAdmin: 1,
    name: 'Ann',
    publishedAt: Date.now(),
    role: 'admin'
  })

  let ids: string[] = await user.create([
    { email: 'a@b.c', name: 'Ann' },
    { email: 'b@b.c', id: 'U2', name: 'Ben', role: 'admin' }
  ])

  await user.update(id, { age: 31 })
  await user.update(id, { role: 'guest', theme: 'light' })
  await user.update(id, { publishedAt: Date.now() })
  await user.update(id, { publishedAt: null })
  await user.update(ids, { role: 'guest' })

  await user.delete(id)
  await user.delete(ids)

  let $admins = user.select`
    WHERE "isAdmin" = ${1} AND "createdAt" > ${new Date(2026, 0, 1).getTime()}
  `
  let value = $admins.get()
  if (!value.isLoading) {
    let row = value.value[0]!
    let name: string = row.name
    let age: null | number = row.age
    let isAdmin: number = row.isAdmin
    let createdAt: number = row.createdAt
    let publishedAt: null | number = row.publishedAt
    let role: 'admin' | 'guest' | 'user' = row.role
    let theme: 'dark' | 'light' = row.theme
    let rowId: string = row.id
    let changed: null | string = row.updatedAt_name
    console.log(
      name,
      age,
      isAdmin,
      createdAt,
      publishedAt,
      role,
      theme,
      rowId,
      changed
    )
  }
  await $admins.loading

  let $joined = user.select`
    JOIN "post" ON "post"."authorId" = "user"."id"
    WHERE "post"."draft" = ${0}
  `
  let joined = $joined.get()
  if (!joined.isLoading) {
    let joinedName: string = joined.value[0]!.name
    console.log(joinedName)
  }

  let $feed = db.store<{
    author: string
    publishedAt: null | number
    title: string
  }>`
    SELECT "post"."title", "user"."name" AS "author", "post"."publishedAt"
    FROM "post" JOIN "user" ON "user"."id" = "post"."authorId"
    WHERE "post"."publishedAt" > ${new Date(2026, 0, 1).getTime()}
  `
  let feed = $feed.get()
  if (!feed.isLoading) {
    let author: string = feed.value[0]!.author
    let publishedAt: null | number = feed.value[0]!.publishedAt
    let title: string = feed.value[0]!.title
    console.log(author, publishedAt, title)
  }

  let $count = db.store<{
    posts: number
  }>`SELECT COUNT(*) AS "posts" FROM "post"`
  let count = $count.get()
  if (!count.isLoading) {
    let posts: number = count.value[0]!.posts
    console.log(posts)
  }
}

let pg = createCrdtDatabase(client, db, { dialect: 'pglite' })
let pgUser = pg.table('user', {
  createdAt: bigint({ default: () => Date.now() }),
  isAdmin: boolean({ default: false }),
  name: string(),
  publishedAt: optional(bigint())
})

let pgValue = pgUser.select`WHERE "isAdmin" = ${true}`.get()
if (!pgValue.isLoading) {
  let pgRow = pgValue.value[0]!
  let pgAdmin: boolean = pgRow.isAdmin
  let pgCreated: number = pgRow.createdAt
  let pgPublished: null | number = pgRow.publishedAt
  let pgName: string = pgRow.name
  console.log(pgAdmin, pgCreated, pgPublished, pgName)
}

let [createdUser, changedUser, deletedUser] = defineCrdtTableActions(user)

console.log(
  createdUser({ fields: { email: 'a@b.c', name: 'Ann' }, id: 'U1' }),
  createdUser({ records: [{ email: 'a@b.c', id: 'U1', name: 'Ann' }] }),
  changedUser({ fields: { age: 31 }, id: 'U1' }),
  changedUser({ fields: { age: 31 }, ids: ['U1', 'U2'] }),
  deletedUser({ id: 'U1' }),
  deletedUser({ ids: ['U1', 'U2'] })
)

test()
console.log(user.plural satisfies string)

crdt.destroy()
pg.destroy()
