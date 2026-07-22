import type { SyncMapTypes } from '@logux/actions'
import type { Database } from '@nanostores/sql'

import { Client } from '../index.js'
import {
  boolean,
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

let crdt = createCrdtDatabase(client, db, {
  dialect: 'pglite',
  key: 'widget:db',
  repeat() {
    return []
  },
  stop() {}
})

let user = crdt.table('user', {
  age: optional(number()),
  createdAt: date({ default: () => new Date() }),
  email: string('COLLATE NOCASE'),
  isAdmin: boolean({ default: false }),
  name: string(),
  publishedAt: optional(date()),
  role: oneOf(['admin', 'guest', 'user'], { default: 'user' }),
  theme: string<'dark' | 'light'>({ default: 'dark' })
})

async function test(): Promise<void> {
  let id: string = await user.create({ email: 'a@b.c', name: 'Ann' })
  await user.create({
    age: 30,
    createdAt: new Date(),
    email: 'a@b.c',
    isAdmin: true,
    name: 'Ann',
    publishedAt: new Date(),
    role: 'admin'
  })

  await user.update(id, { age: 31 })
  await user.update(id, { role: 'guest', theme: 'light' })
  await user.update(id, { publishedAt: new Date() })

  await user.delete(id)

  let $admins = user.select`
    WHERE "isAdmin" = ${true} AND "createdAt" > ${new Date(2026, 0, 1)}
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
    let changed: string = row.updatedAt
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
    WHERE "post"."draft" = ${false}
  `
  let joined = $joined.get()
  if (!joined.isLoading) {
    let joinedName: string = joined.value[0]!.name
    console.log(joinedName)
  }

  let $feed = crdt.sql<{
    author: string
    publishedAt: null | number
    title: string
  }>`
    SELECT "post"."title", "user"."name" AS "author", "post"."publishedAt"
    FROM "post" JOIN "user" ON "user"."id" = "post"."authorId"
    WHERE "post"."publishedAt" > ${new Date(2026, 0, 1)}
  `
  let feed = $feed.get()
  if (!feed.isLoading) {
    let author: string = feed.value[0]!.author
    let publishedAt: null | number = feed.value[0]!.publishedAt
    let title: string = feed.value[0]!.title
    console.log(author, publishedAt, title)
  }

  let $count = crdt.sql`SELECT COUNT(*) AS "posts" FROM "post"`
  let count = $count.get()
  if (!count.isLoading) {
    let posts: SyncMapTypes = count.value[0]!.posts
    console.log(posts)
  }
}

test()
console.log(user.plural satisfies string)
