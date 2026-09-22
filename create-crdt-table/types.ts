import { defineAction, defineCrdtTableActions } from '@logux/actions'
import type { Action, MetaTime } from '@logux/core'
import type { Database } from '@nanostores/sql'

import { Client, type WithoutMeta, withoutMeta } from '../index.js'
import {
  bigint,
  boolean,
  createCrdtDatabase,
  crdtTableToActions,
  type CrdtCell,
  json,
  number,
  oneOf,
  optional,
  parseCrdtAction,
  parseCrdtRows,
  parseCrdtType,
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
  repeat() {
    return []
  },
  storage: {},
  sync: false
})
crdt.on('applied', (tx, action, meta, won, touched) => {
  let cells: CrdtCell[] = won
  let lost: CrdtCell[] = touched
  if ('reasons' in meta) {
    for (let [table, id, field] of cells) {
      void client.log.removeReason(`${table}/${id}/${field}`, {
        olderThan: meta
      })
    }
    for (let cell of lost) {
      void client.log.removeReason(cell.join('/'), { id: meta.id })
    }
  }
  console.log(tx, action.type, meta.id, meta.time)
})
crdt.on('migrating', done => {
  void done.then(() => {})
})
crdt.on('stop', () => {})

let user = crdt.table(
  'user',
  {
    address: optional(json({ city: string(), zip: optional(string()) })),
    age: optional(number()),
    createdAt: bigint({ default: () => Date.now() }),
    email: string('COLLATE NOCASE'),
    isAdmin: number({ default: 0 }),
    name: string(),
    publishedAt: optional(bigint()),
    role: oneOf(['admin', 'guest', 'user'], { default: 'user' }),
    settings: json(
      {
        fontSize: number(),
        notifications: optional(json({ email: boolean(), push: boolean() })),
        theme: oneOf(['dark', 'light'])
      },
      { default: { fontSize: 14, theme: 'dark' } }
    ),
    tags: json([string()], { default: () => [] }),
    theme: string<'dark' | 'light'>({ default: 'dark' })
  },
  [
    'name',
    'createdAt DESC',
    'email COLLATE NOCASE',
    'id',
    'updatedAt_name',
    ['isAdmin', 'name'],
    { columns: ['age', 'role'] },
    { columns: ['email'], unique: true },
    {
      sql:
        'CREATE INDEX IF NOT EXISTS "user_admins" ON "user" ("name")' +
        ' WHERE "isAdmin" = 1'
    }
  ]
)

async function test(): Promise<void> {
  await crdt.ready
  let status: 'broken' | 'initializing' | 'migrating' | 'outdated' | 'ready' =
    crdt.status.get()
  console.log(status)

  let id: string = await user.create({ email: 'a@b.c', name: 'Ann' })
  await user.create({
    address: { city: 'Riga' },
    age: 30,
    createdAt: Date.now(),
    email: 'a@b.c',
    isAdmin: 1,
    name: 'Ann',
    publishedAt: Date.now(),
    role: 'admin',
    settings: {
      fontSize: 16,
      notifications: { email: true, push: false },
      theme: 'light'
    },
    tags: ['a', 'b']
  })
  await user.create({
    address: null,
    email: 'a@b.c',
    name: 'Ann',
    settings: { fontSize: 16, notifications: null, theme: 'light' }
  })

  await user.create({
    age: null,
    email: 'a@b.c',
    name: 'Ann',
    publishedAt: null
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
  await user.update(id, {
    address: { city: 'Riga', zip: '1010' },
    settings: { fontSize: 12, theme: 'dark' },
    tags: ['c']
  })
  await user.update(id, { address: null })

  await user.delete(id)
  await user.delete(ids)

  let $admins = user.select`
    WHERE "isAdmin" = ${1} AND "createdAt" > ${new Date(2026, 0, 1).getTime()}
  `
  let value = $admins.get()
  if (value.status === 'ready') {
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
    let settings: {
      fontSize: number
      notifications?: null | { email: boolean; push: boolean }
      theme: 'dark' | 'light'
    } = row.settings
    let fontSize: number = row.settings.fontSize
    let push: boolean | undefined = row.settings.notifications?.push
    let tags: string[] = row.tags
    let address: null | { city: string; zip?: null | string } = row.address
    let city: string | undefined = row.address?.city
    let settingsChanged: null | string = row.updatedAt_settings
    console.log(
      name,
      age,
      isAdmin,
      createdAt,
      publishedAt,
      role,
      theme,
      rowId,
      changed,
      settings,
      fontSize,
      push,
      tags,
      address,
      city,
      settingsChanged
    )

    let clean: WithoutMeta<(typeof value.value)[number]>[] = withoutMeta(
      value.value
    )
    let cleanId: string = clean[0]!.id
    let cleanName: string = clean[0]!.name
    let cleanAge: null | number = clean[0]!.age
    let cleanRole: 'admin' | 'guest' | 'user' = clean[0]!.role
    console.log(cleanId, cleanName, cleanAge, cleanRole)

    // Rows with `null` in optional columns can be inserted back
    let restored: string[] = await user.create(clean)
    let copy: string = await user.create({ ...clean[0]!, id: undefined })
    console.log(restored, copy)
  }
  await $admins.loading

  let $joined = user.select`
    JOIN "post" ON "post"."authorId" = "user"."id"
    WHERE "post"."draft" = ${0}
  `
  let joined = $joined.get()
  if (joined.status === 'ready') {
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
  if (feed.status === 'ready') {
    let author: string = feed.value[0]!.author
    let publishedAt: null | number = feed.value[0]!.publishedAt
    let title: string = feed.value[0]!.title
    console.log(author, publishedAt, title)
  }

  let $count = db.store<{
    posts: number
  }>`SELECT COUNT(*) AS "posts" FROM "post"`
  let count = $count.get()
  if (count.status === 'ready') {
    let posts: number = count.value[0]!.posts
    console.log(posts)
  }
}

let pg = createCrdtDatabase(client, db, {
  dialect: 'pglite',
  storage: localStorage
})
let pgUser = pg.table('user', {
  createdAt: bigint({ default: () => Date.now() }),
  isAdmin: boolean({ default: false }),
  name: string(),
  publishedAt: optional(bigint()),
  settings: json({ theme: string() })
})

let pgValue = pgUser.select`WHERE "isAdmin" = ${true}`.get()
if (pgValue.status === 'ready') {
  let pgRow = pgValue.value[0]!
  let pgAdmin: boolean = pgRow.isAdmin
  let pgCreated: number = pgRow.createdAt
  let pgPublished: null | number = pgRow.publishedAt
  let pgName: string = pgRow.name
  let pgTheme: string = pgRow.settings.theme
  console.log(pgAdmin, pgCreated, pgPublished, pgName, pgTheme)
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

let userRenamed = defineAction<{
  id: string
  name: string
  type: 'user/renamed'
}>('user/renamed')

let renameUser = crdt.action(
  userRenamed,
  async (tx, action, meta) => {
    let name: string = action.name
    let won: CrdtCell[] = await user.change(tx, action.id, { name }, meta)
    console.log(won)
    await user.change(tx, [action.id], { age: 31 }, meta)
    await tx.exec`UPDATE "user" SET "isAdmin" = ${1} WHERE "id" = ${action.id}`
  },
  { version: 2 }
)

async function rename(): Promise<void> {
  await renameUser({ id: 'U1', name: 'New' })
}

client.on('preadd', (action, meta) => {
  let parsed = parseCrdtAction(action, crdt)
  if (!parsed) return
  let verb: 'changed' | 'created' | 'deleted' = parsed.verb
  console.log(verb)
  for (let [id, fields] of parsed.rows) {
    for (let field of fields) {
      meta.reasons.push(`${parsed.plural}/${id}/${field}`)
    }
  }
})

let parsedType = parseCrdtType('user/created', crdt)
if (parsedType) {
  let plural: string = parsedType.plural
  let verb: 'changed' | 'created' | 'deleted' = parsedType.verb
  console.log(plural, verb)
}

declare let tableAction: Action

for (let [id, fields] of parseCrdtRows(tableAction)) {
  console.log(id, fields)
}

async function repeatAll(): Promise<void> {
  let entries: [Action, MetaTime][] = await crdtTableToActions([user, pgUser])
  console.log(entries[0]![0].type, entries[0]![1].id)
}

void repeatAll()
void rename()
test()
console.log(user.plural satisfies string)
console.log(user.schema.name.type satisfies 'TEXT')
console.log(user.schema.settings.type satisfies 'JSON')

let unbinds: (() => void)[] = [
  crdt.on('applied', async (tx, action, meta, won, touched) => {
    await tx.driver.select('SELECT 1', [])
    console.log(action.type, meta.id, won.length, touched.length)
  }),
  crdt.on('corrupted', (reason, error) => {
    console.log(reason, error)
  }),
  crdt.on('migrating', done => {
    void done.then(() => {})
  }),
  crdt.on('stop', () => {})
]
for (let unbind of unbinds) unbind()

crdt.destroy()
pg.destroy()
