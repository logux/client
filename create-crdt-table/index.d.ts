import type { AbstractActionCreator, SyncMapTypes } from '@logux/actions'
import type { Action } from '@logux/core'
import type { Database, SqlStore } from '@nanostores/sql'
import type { ReadableAtom } from 'nanostores'

import type { Client, ClientMeta } from '../client/index.js'

type CrdtMigrationStatus = 'initializing' | 'migrating' | 'outdated' | 'ready'

/**
 * Prefix of columns with Logux Meta ID of the last change of every field
 * for CRDT LWW.
 */
declare const META: 'updatedAt_'

/**
 * JS types of column values. Only JSON types are supported, because
 * all values are stored in Logux actions and passed to the database
 * driver as-is. Store dates as a number of milliseconds
 * in {@link bigint} columns.
 */
export type CrdtColumnValue = SyncMapTypes

export interface CrdtColumnOptions<Type extends CrdtColumnValue> {
  /**
   * Default value or function to get it. Column with default becomes
   * optional in {@link CrdtTable#create}. The default is resolved
   * when the create action is added and is stored inside the action,
   * so replaying the log is deterministic.
   */
  default?: (() => NoInfer<Type>) | NoInfer<Type>

  /**
   * Extra SQL appended to the column definition, like
   * `'UNIQUE COLLATE NOCASE'`. Pass a string to use it for every database,
   * or an object with {@link CrdtDatabaseOptions#dialect} names as keys
   * to set SQL per database dialect.
   */
  sql?: Record<Dialects, string> | string
}

/**
 * Column definition created by {@link string}, {@link number},
 * {@link bigint}, {@link boolean}, {@link oneOf} and {@link optional}
 * builders.
 *
 * `Type` is the JS type of the column value in rows.
 * `RequiredOnCreate` marks whether {@link CrdtTable#create} requires
 * the field (columns wrapped in `optional()` or having `default` don’t).
 */
export interface CrdtColumn<
  Type extends CrdtColumnValue = CrdtColumnValue,
  RequiredOnCreate extends boolean = boolean
> {
  default?: (() => Type) | Type
  required: RequiredOnCreate
  sql?: Record<string, string> | string

  /**
   * SQL column type used in `CREATE TABLE`.
   */
  type: 'BIGINT' | 'BOOLEAN' | 'DOUBLE PRECISION' | 'TEXT'
  values?: readonly string[]
}

/**
 * `TEXT` column with `string` value.
 *
 * ```ts
 * import { string } from '@logux/client'
 *
 * let schema = {
 *   email: string('COLLATE NOCASE'),
 *   name: string(),
 *   theme: string<'dark' | 'light'>({ default: 'dark' })
 * }
 * ```
 *
 * @param opts Extra column definition SQL or column options.
 */
export function string<Type extends string = string>(
  opts?: Omit<CrdtColumnOptions<Type>, 'default'> | string
): { type: 'TEXT' } & CrdtColumn<Type, true>
export function string<Type extends string = string>(
  opts: { default: NoInfer<Type> } & CrdtColumnOptions<Type>
): { type: 'TEXT' } & CrdtColumn<Type, false>

/**
 * `DOUBLE PRECISION` column with `number` value.
 *
 * @param opts Extra column definition SQL or column options.
 */
export function number<Type extends number = number>(
  opts?: Omit<CrdtColumnOptions<Type>, 'default'> | string
): { type: 'DOUBLE PRECISION' } & CrdtColumn<Type, true>
export function number<Type extends number = number>(
  opts: { default: NoInfer<Type> } & CrdtColumnOptions<Type>
): { type: 'DOUBLE PRECISION' } & CrdtColumn<Type, false>

/**
 * `BOOLEAN` column for databases with native boolean support like PGlite.
 * SQLite has no boolean type, so with `'sqlite'` dialect use
 * {@link number} column with `1`/`0` instead (using this builder there
 * is a type error and throws in {@link CrdtDatabase#table}).
 *
 * @param opts Extra column definition SQL or column options.
 */
export function boolean(
  opts?: Omit<CrdtColumnOptions<boolean>, 'default'> | string
): { type: 'BOOLEAN' } & CrdtColumn<boolean, true>
export function boolean(
  opts: { default: (() => boolean) | boolean } & CrdtColumnOptions<boolean>
): { type: 'BOOLEAN' } & CrdtColumn<boolean, false>

/**
 * Enum column with union of string values. Stored as `TEXT`
 * with `CHECK` constraint.
 *
 * ```ts
 * import { oneOf } from '@logux/client/db'
 *
 * let schema = {
 *   role: oneOf(['admin', 'guest', 'user'], { default: 'user' }),
 *   theme: oneOf(['dark', 'light'])
 * }
 * ```
 *
 * @param values Allowed string values.
 * @param opts Extra column definition SQL or column options.
 */
export function oneOf<const Values extends readonly [string, ...string[]]>(
  values: Values,
  opts?: Omit<CrdtColumnOptions<Values[number]>, 'default'> | string
): { type: 'TEXT' } & CrdtColumn<Values[number], true>
export function oneOf<const Values extends readonly [string, ...string[]]>(
  values: Values,
  opts: {
    default: (() => Values[number]) | Values[number]
  } & CrdtColumnOptions<Values[number]>
): { type: 'TEXT' } & CrdtColumn<Values[number], false>

/**
 * `BIGINT` column with `number` value. Use it for timestamps
 * as a number of milliseconds — the same format as dates
 * in Logux actions:
 *
 * ```ts
 * import { bigint } from '@logux/client/db'
 *
 * let schema = {
 *   createdAt: bigint({ default: () => Date.now() }),
 *   publishedAt: optional(bigint())
 * }
 * ```
 *
 * @param opts Extra column definition SQL or column options.
 */
export function bigint<Type extends number = number>(
  opts?: Omit<CrdtColumnOptions<Type>, 'default'> | string
): { type: 'BIGINT' } & CrdtColumn<Type, true>
export function bigint<Type extends number = number>(
  opts: {
    default: (() => NoInfer<Type>) | NoInfer<Type>
  } & CrdtColumnOptions<Type>
): { type: 'BIGINT' } & CrdtColumn<Type, false>

/**
 * Mark column as optional. The field can be omitted or set to `null`
 * in {@link CrdtTable#create}, can be set to `null`
 * in {@link CrdtTable#update} to clear the value, and is `null`
 * (SQL `NULL`) in rows when missing.
 *
 * ```ts
 * import { number, optional } from '@logux/client'
 *
 * let schema = {
 *   age: optional(number())
 * }
 * ```
 *
 * @param column Column definition to wrap.
 */
export function optional<Column extends CrdtColumn>(
  column: Column
): { type: Column['type'] } & CrdtColumn<
  CrdtColumnType<Column> | undefined,
  false
>

export interface CrdtTableSchema<
  Types extends CrdtColumn['type'] = CrdtColumn['type']
> {
  [column: string]: { type: Types } & CrdtColumn
}

type CrdtIndexName<Schema extends CrdtTableSchema> =
  | 'id'
  | `updatedAt_${keyof Schema & string}`
  | (keyof Schema & string)

/**
 * Column in {@link CrdtIndex}: a column name from the table schema,
 * `id`, or an `updatedAt_field` column.
 *
 * Everything after the column name is passed to the database as is,
 * so it can contain `DESC`, `COLLATE` or an operator class:
 *
 * ```ts
 * let post = crdt.table('post', schema, [
 *   'publishedAt DESC',
 *   'title COLLATE NOCASE'
 * ])
 * ```
 */
export type CrdtIndexColumn<Schema extends CrdtTableSchema> =
  | `${CrdtIndexName<Schema>} ${string}`
  | CrdtIndexName<Schema>

/**
 * Index definition for {@link CrdtDatabase#table}. It can be:
 *
 * - a column name for a single-column index;
 * - an array of columns for a multi-column index;
 * - an object with `columns` and `unique`;
 * - an object with the whole `CREATE INDEX` statement in `sql`
 *   for partial indexes, expressions and dialect-specific features.
 *
 * ```ts
 * let user = crdt.table('user', schema, [
 *   'email',
 *   ['teamId', 'name'],
 *   { columns: ['email'], unique: true },
 *   {
 *     sql: `CREATE INDEX IF NOT EXISTS "user_active" ON "user" ("name")` +
 *       ` WHERE "role" = 'admin'`
 *   }
 * ])
 * ```
 */
export type CrdtIndex<Schema extends CrdtTableSchema> =
  | { columns: CrdtIndexColumn<Schema>[]; unique?: boolean }
  | { sql: string }
  | CrdtIndexColumn<Schema>
  | CrdtIndexColumn<Schema>[]

export type CrdtColumnType<Column extends CrdtColumn> =
  Column extends CrdtColumn<infer Type, boolean> ? Type : never

/**
 * Row fields (without `id` and fields meta) inferred from table schema.
 * Optional columns take `null` to clear the value
 * (`undefined` fields are not changed, like in JSON).
 */
export type CrdtRowFields<Schema extends CrdtTableSchema> = {
  [
    Column in keyof Schema as undefined extends CrdtColumnType<Schema[Column]>
      ? Column
      : never
  ]?: Exclude<CrdtColumnType<Schema[Column]>, undefined> | null
} & {
  [
    Column in keyof Schema as undefined extends CrdtColumnType<Schema[Column]>
      ? never
      : Column
  ]: CrdtColumnType<Schema[Column]>
}

/**
 * Fields accepted by {@link CrdtTable#create}. Columns wrapped in
 * {@link optional} or having `default` can be omitted.
 */
export type CrdtCreateFields<Schema extends CrdtTableSchema> = {
  [
    Column in keyof Schema as Schema[Column] extends CrdtColumn<any, false>
      ? Column
      : never
  ]?: undefined extends CrdtColumnType<Schema[Column]>
    ? Exclude<CrdtColumnType<Schema[Column]>, undefined> | null
    : CrdtColumnType<Schema[Column]>
} & {
  [
    Column in keyof Schema as Schema[Column] extends CrdtColumn<any, false>
      ? never
      : Column
  ]: CrdtColumnType<Schema[Column]>
}

/**
 * Row accepted by {@link CrdtTable#create}: {@link CrdtCreateFields}
 * with optional `id`, which will be generated if omitted.
 */
export type NewCrdtRow<Schema extends CrdtTableSchema> = {
  id?: string
} & CrdtCreateFields<Schema>

/**
 * Values for SQL template parameters of {@link CrdtTable#select}.
 * Parameters are passed to the database driver as-is, without any
 * conversion. Booleans are allowed only in dialects
 * with {@link boolean} columns (not in `'sqlite'`).
 */
export type CrdtSqlParam<Dialect extends Dialects = 'sqlite'> =
  | (Dialect extends 'sqlite' ? never : boolean)
  | number
  | string

/**
 * Table row returned by {@link CrdtTable#select}. Rows contain data
 * as the database driver returns it, without any conversion.
 * Missing optional columns are `null`.
 *
 * Every field has an extra `updatedAt_field` column with Logux Meta ID
 * of the last action which changed it (`null` if the field was never set).
 * They are used to resolve conflicts with per-field last write wins,
 * and can be used in SQL, for instance, to sort by the last change:
 *
 * ```ts
 * let $recent = user.select`ORDER BY "updatedAt_name" DESC`
 * ```
 */
export type CrdtTableRow<Schema extends CrdtTableSchema> = {
  id: string
} & {
  [Column in keyof Schema]: undefined extends CrdtColumnType<Schema[Column]>
    ? Exclude<CrdtColumnType<Schema[Column]>, undefined> | null
    : CrdtColumnType<Schema[Column]>
} & {
  [Column in keyof Schema as `updatedAt_${Column & string}`]: null | string
}

/**
 * Row without conflict resolution data of every field.
 */
export type WithoutMeta<Value> = {
  [
    Key in keyof Value as Key extends `${typeof META}${string}` ? never : Key
  ]: Value[Key]
}

/**
 * Remove conflict resolution data, which is local and should not be
 * in the backup or in tests expectations.
 *
 * ```ts
 * expect(withoutMeta(await loadList(user.select()))).toEqual([
 *   { id: 'U1', name: 'Ann' }
 * ])
 * ```
 *
 * @param rows Rows from {@link CrdtTable#select}.
 * @returns Rows without `updatedAt_field` columns.
 */
export function withoutMeta<Value extends object>(
  rows: Value[]
): WithoutMeta<Value>[]

/**
 * Add empty conflict resolution data to a row built in tests, so it could
 * be compared with rows from {@link CrdtTable#select}.
 *
 * ```ts
 * expect(await loadList(user.select())).toEqual([
 *   withMeta<UserValue>({ id: 'U1', name: 'Ann' })
 * ])
 * ```
 *
 * @param row Row without `updatedAt_field` columns.
 * @returns Row with `null` in `updatedAt_field` column of every field.
 */
export function withMeta<Value>(row: WithoutMeta<Value>): Value

export interface CrdtTable<
  Schema extends CrdtTableSchema = CrdtTableSchema,
  Dialect extends string = 'sqlite'
> {
  /**
   * Change row fields from a custom action of {@link CrdtDatabase#action}
   * with the same per-field last write wins as {@link CrdtTable#update}.
   *
   * Unlike {@link CrdtTable#update}, it does not add an action to the log.
   * Use it instead of your own `UPDATE` to not write `updatedAt_field`
   * columns manually and to not lose conflict resolution: like
   * {@link CrdtTable#update}, it ignores older changes and rows,
   * which were not created yet or were deleted on another client.
   *
   * ```ts
   * let renameUser = crdt.action(userRenamed, async (tx, action, meta) => {
   *   await user.change(tx, action.id, { name: action.name }, meta)
   * })
   * ```
   *
   * @param tx Database from the action callback.
   * @param id Row ID or an array of row IDs.
   * @param fields Changed fields.
   * @param meta Meta of the action from the callback.
   * @returns Promise resolved when rows were changed.
   */
  change(
    tx: Database,
    id: string[] | string,
    fields: Partial<CrdtRowFields<Schema>>,
    meta: ClientMeta
  ): Promise<void>

  /**
   * Add `plural/created` action to the log. The table row will be inserted
   * by the reducer (in a single browser tab) when the action is processed.
   *
   * Pass an array of rows to create them by a single batch action. It is
   * much faster than an action per row: rows are sent in one message
   * and are inserted in one SQL query.
   *
   * ```js
   * let id = await user.create({ name: 'Ann' })
   * let ids = await user.create([{ name: 'Ann' }, { name: 'Ben' }])
   * ```
   *
   * @param fields Row fields or an array of rows for a batch action.
   *               `id` will be generated if omitted.
   * @returns Promise with row ID (or IDs of all rows in the batch)
   *          resolved when the row was inserted into the table.
   */
  create(rows: NewCrdtRow<Schema>[]): Promise<string[]>
  create(fields: NewCrdtRow<Schema>): Promise<string>
  create(
    fields: NewCrdtRow<Schema> | NewCrdtRow<Schema>[]
  ): Promise<string[] | string>

  /**
   * Add `plural/deleted` action to the log to remove the row.
   *
   * Pass an array of IDs to remove all these rows by a single
   * batch action.
   *
   * ```js
   * await user.delete(id)
   * await user.delete([id1, id2])
   * ```
   *
   * @param id Row ID or an array of row IDs for a batch action.
   * @returns Promise resolved when the table was changed.
   */
  delete(id: string[] | string): Promise<void>

  /**
   * Table name. It is used as SQL table name and as prefix
   * of action types (`user/created`, `user/changed`, `user/deleted`).
   */
  readonly plural: string

  /**
   * Reactive SQL query to the table. Use it as a template string tag
   * (like `db.store` in Nano Stores SQL); interpolated values are passed
   * as bound SQL parameters to the database driver as-is, so use
   * raw dialect values like in rows (see {@link CrdtSqlParam}).
   *
   * The SQL is appended to `SELECT "plural".* FROM "plural"`,
   * so it can contain `WHERE`, `ORDER BY`, `LIMIT`, and even `JOIN`
   * to filter rows by other tables (only this table’s columns are
   * returned; use `db.store` from Nano Stores SQL for manual queries
   * with joined columns or aggregations).
   *
   * ```ts
   * let $all = user.select()
   * let $admins = user.select`WHERE "isAdmin" = ${1} ORDER BY "name"`
   * let $authors = user.select`
   *   JOIN "post" ON "post"."authorId" = "user"."id"
   *   WHERE "post"."draft" = ${0}
   * `
   * ```
   *
   * @param sql SQL template after `SELECT "table".* FROM "table"`.
   *            Omit to select all rows.
   * @param params Interpolated template values.
   */
  select(
    sql?: TemplateStringsArray,
    ...params: CrdtSqlParam<Dialect>[]
  ): SqlStore<CrdtTableRow<Schema>[]>

  /**
   * Add `plural/changed` action to the log with changed fields.
   * Conflicts with parallel changes are resolved with per-field
   * last write wins by `updatedAt_field` values. Changes of rows deleted
   * on another client are ignored.
   *
   * Set optional field to `null` to clear its value. `undefined` fields
   * are not changed (JSON, used to sync actions, has no `undefined`).
   *
   * Pass an array of IDs to apply the same changes to all these rows
   * by a single batch action.
   *
   * ```js
   * await user.update(id, { role: 'admin' })
   * await user.update([id1, id2], { role: 'admin' })
   * ```
   *
   * @param id Row ID or an array of row IDs for a batch action.
   * @param diff Changed fields.
   * @returns Promise resolved when the table was changed.
   */
  update(
    id: string[] | string,
    diff: Partial<CrdtRowFields<Schema>>
  ): Promise<void>
}

export interface CrdtActionOptions {
  /**
   * Version of the callback’s logic. Adding or removing an action re-creates
   * the database from the log automatically, but a change inside
   * the callback is not visible to the library. Increase this number
   * to re-create the database after such change.
   */
  version?: number
}

export interface CrdtDatabaseOptions<Dialect extends string = 'sqlite'> {
  /**
   * SQL dialect of the database: `'sqlite'` (default), `'pglite'`
   * or any other name for your own dialect. The dialect selects
   * per-dialect extra column SQL in {@link CrdtColumnOptions#sql}
   * and prohibits {@link boolean} columns in SQLite
   * (values are passed to the database driver without conversion
   * and SQLite has no boolean type).
   */
  dialect?: Dialect

  /**
   * `localStorage` key to store the schema version
   * (also used as the prefix of the leader tab lock name).
   * Change it when the database is used in a third-party widget
   * to avoid conflicts with the website’s own Logux database.
   * Default is `logux:db`.
   */
  key?: string

  /**
   * Called when the table schema was changed and tables are being dropped
   * and refilled from the log. A good place to show a “migrating database”
   * loader until the passed promise is resolved.
   *
   * ```js
   * let crdt = createCrdtDatabase(client, db, {
   *   migrating(done) {
   *     showLoader('Migrating database', done)
   *   }
   * })
   * ```
   *
   * @param done Promise resolved when the database is ready
   *             (the same as {@link CrdtDatabase#ready}).
   */
  migrating?(done: Promise<void>): void

  /**
   * Called after the database was dropped on schema change to get old
   * actions missing from the log (for instance, from the server or
   * from a compacted snapshot). Actions from the log will be replayed
   * automatically.
   */
  repeat?(): [Action, ClientMeta][] | Promise<[Action, ClientMeta][]>

  /**
   * Called when another browser tab has a newer table schema and this tab
   * must stop touching the database (good place to show “reload the page”
   * warning).
   */
  stop?(): void
}

export interface CrdtDatabase<Dialect extends string = 'sqlite'> {
  /**
   * Define custom action, which will be applied to the database
   * by your callback.
   *
   * The callback is called only in a single browser tab (like the reducer
   * of {@link CrdtDatabase#table} actions), inside a transaction, and only
   * after the database is ready. On schema changes the action will be
   * replayed from the log with all other actions, so the callback must
   * only work with the database: no `log.add()`, no HTTP requests,
   * no `Date.now()`.
   *
   * All actions must be defined synchronously after
   * {@link createCrdtDatabase} call, because the schema version
   * is calculated from all tables and actions.
   *
   * Use {@link CrdtTable#change} to change rows of CRDT tables: it keeps
   * per-field last write wins by `updatedAt_field` columns.
   *
   * ```ts
   * import { defineAction } from '@logux/actions'
   *
   * let userRenamed = defineAction<{
   *   id: string
   *   name: string
   *   type: 'user/renamed'
   * }>('user/renamed')
   *
   * let renameUser = crdt.action(userRenamed, async (tx, action, meta) => {
   *   await user.change(tx, action.id, { name: action.name }, meta)
   *   await tx.exec`
   *     UPDATE "user" SET "renames" = "renames" + 1 WHERE "id" = ${action.id}
   *   `
   * })
   *
   * await renameUser({ id, name: 'New' })
   * ```
   *
   * @param creator Action creator from `defineAction()`.
   * @param apply Callback to apply the action to the database.
   * @param opts Action options.
   * @returns Function to add the action to the log, send it to the server,
   *          and wait for the callback to apply it to the database.
   */
  action<Creator extends AbstractActionCreator>(
    creator: Creator,
    apply: (
      tx: Database,
      action: ReturnType<Creator>,
      meta: ClientMeta
    ) => Promise<void> | void,
    opts?: CrdtActionOptions
  ): (...args: Parameters<Creator>) => Promise<void>

  /**
   * Drop all tables and stop the database like {@link CrdtDatabase#destroy}.
   *
   * It will be auto-called on {@link Client#clean}.
   *
   * @returns Promise resolved when all tables were dropped.
   */
  clean(): Promise<void>

  /**
   * Stop the database: release the leader tab lock, unsubscribe from the log
   * and from other tabs’ schema changes.
   *
   * Call it before creating the next database in the same page on user
   * change or between tests, or if you have a browser tab
   * with more recent JS bundle.
   *
   * ```js
   * crdt.destroy()
   * await db.close()
   * ```
   */
  destroy(): void

  /**
   * Delete all rows from all tables, but keep the database ready to use.
   *
   * ```js
   * afterEach(async () => {
   *   await crdt.empty()
   * })
   * ```
   *
   * @returns Promise resolved when all tables became empty.
   */
  empty(): Promise<void>

  /**
   * Promise resolved when the database was prepared and tables can be used.
   *
   * It is also resolved when the database became `outdated`, so awaiting it
   * will never hang. Check {@link CrdtDatabase#status} if you need to know
   * which of them happened.
   *
   * ```js
   * showLoaderUntil(crdt.ready, 'Loading data')
   * ```
   */
  readonly ready: Promise<void>

  /**
   * Database preparing status:
   *
   * - `initializing`: reading schema version, checking tables.
   * - `migrating`: schema was changed, tables are being dropped and refilled
   *   from the log and {@link CrdtDatabaseOptions#repeat}.
   * - `ready`: tables can be used.
   * - `outdated`: another tab has a newer schema, this tab must be reloaded.
   */
  status: ReadableAtom<CrdtMigrationStatus>

  /**
   * Define CRDT table in the database.
   *
   * All tables must be defined synchronously after
   * {@link createCrdtDatabase} call, because the schema version
   * is calculated from all tables.
   *
   * ```ts
   * let user = crdt.table(
   *   'user',
   *   {
   *     email: string('COLLATE NOCASE'),
   *     name: string(),
   *     teamId: optional(string())
   *   },
   *   ['email', ['teamId', 'name']]
   * )
   * ```
   *
   * Indexes have no names in the API and are compared by their SQL:
   * any change in them re-creates the database, since tables are dropped
   * and refilled from the log with their indexes.
   *
   * @param plural Table name and actions type prefix.
   * @param schema Columns definition from {@link string}, {@link number},
   *               {@link bigint}, {@link boolean}, {@link oneOf},
   *               {@link optional} builders. {@link boolean} is not
   *               allowed with `'sqlite'` dialect.
   * @param indexes Indexes to create for the table. The dialect is known
   *                here, so use a condition to define an index
   *                for a specific database.
   */
  table<
    Schema extends CrdtTableSchema<
      Dialect extends 'sqlite'
        ? Exclude<CrdtColumn['type'], 'BOOLEAN'>
        : CrdtColumn['type']
    >
  >(
    plural: string,
    schema: Schema,
    indexes?: CrdtIndex<NoInfer<Schema>>[]
  ): CrdtTable<Schema, Dialect>
}

export type Dialects = 'sqlite' | 'pglite'

/**
 * Create CRDT LWW Map tables on top of SQL database filled from Logux log.
 *
 * Tables are filled by reducing actions from the log (like
 * {@link createReducer}). {@link CrdtTable#create},
 * {@link CrdtTable#update} and {@link CrdtTable#delete} add actions
 * to the log, and the reducer applies them to the database. Their promises
 * are resolved only after the tables were changed, so the next
 * {@link CrdtTable#select} will already see the change. They are rejected
 * if applying failed or if the database was stopped before it.
 *
 * Until the action is applied, it is kept in the log by the `key:crdt`
 * reason. Any tab can take the `key:apply` lock, apply the actions
 * in batches, and remove the reason. Actions of the tab, which was closed
 * in the middle of the work, will be applied on the next start.
 *
 * Actions are the same as in {@link syncMapTemplate}
 * (`user/created`, `user/changed`, `user/deleted` from `@logux/actions`),
 * so tables are compatible with existing Logux servers and can be mixed
 * with `syncMapTemplate` stores on other clients. Arrays in
 * {@link CrdtTable#create}, {@link CrdtTable#update} and
 * {@link CrdtTable#delete} produce batch actions (with `records` or `ids`
 * instead of `id`), which are applied to the database in a single query.
 *
 * Each table has an extra `id` column and an `updatedAt_field` column
 * for every field with the Logux Meta ID of its last change, to resolve
 * edit conflicts with per-field last write wins strategy.
 *
 * The schema version — serialized schemas and indexes of all tables — is kept
 * in `localStorage`. On any schema change all tables (including tables
 * removed from the schema) are dropped and refilled by replaying actions
 * from the log and from the `repeat()` callback.
 *
 * While there are actions waiting to be applied to the database, the tab
 * asks the user to confirm closing. It only saves the user from waiting
 * for the next start: it guarantees nothing, since the browser can close
 * the tab without asking, and the actions are not lost anyway.
 *
 * ```ts
 * import { openDb, sqlocalDriver } from '@nanostores/sql'
 * import {
 *   bigint, createCrdtDatabase, number, oneOf, optional, string
 * } from '@logux/client/db'
 *
 * let db = openDb(sqlocalDriver('app.sqlite'))
 * let crdt = createCrdtDatabase(client, db, {
 *   migrating(done) {
 *     showLoader('Migrating database', done)
 *   },
 *   async repeat() {
 *     return await fetchActionsSnapshot()
 *   },
 *   stop() {
 *     updateAppWarning.show()
 *   }
 * })
 *
 * showLoader('Loading data', crdt.ready)
 *
 * let user = crdt.table(
 *   'user',
 *   {
 *     age: optional(number()),
 *     createdAt: bigint({ default: () => Date.now() }),
 *     email: string('COLLATE NOCASE'),
 *     isAdmin: number({ default: 0 }),
 *     name: string(),
 *     theme: oneOf(['dark', 'light'], { default: 'dark' })
 *   },
 *   [{ columns: ['email'], unique: true }, ['isAdmin', 'name']]
 * )
 *
 * let id = await user.create({ email: 'ann@example.com', name: 'Ann' })
 * await user.update(id, { age: 30 })
 * let $admins = user.select`WHERE "isAdmin" = ${1} ORDER BY "name"`
 * await user.delete(id)
 * ```
 *
 * @param client Logux client.
 * @param db SQL database from `@nanostores/sql` `openDb()`.
 * @param opts Database options, old actions source and migration callbacks.
 */
export function createCrdtDatabase<Dialect extends Dialects = 'sqlite'>(
  client: Client,
  db: Database,
  opts?: CrdtDatabaseOptions<Dialect>
): CrdtDatabase<Dialect>
