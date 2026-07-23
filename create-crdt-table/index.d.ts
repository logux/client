import type { SyncMapTypes } from '@logux/actions'
import type { Action } from '@logux/core'
import type { Database, SqlStore } from '@nanostores/sql'
import type { ReadableAtom } from 'nanostores'

import type { Client, ClientMeta } from '../client/index.js'

type CrdtMigrationStatus = 'initializing' | 'outdated' | 'ready' | 'updating'

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
 * Mark column as optional. The field can be omitted in
 * {@link CrdtTable#create}, can be set to `null`
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

export type CrdtColumnType<Column extends CrdtColumn> =
  Column extends CrdtColumn<infer Type, boolean> ? Type : never

/**
 * Row fields (without `id` and `updatedAt`) inferred from table schema.
 * Optional columns take `null` to clear the value
 * (`undefined` fields are not changed, like in JSON).
 */
export type CrdtRowFields<Schema extends CrdtTableSchema> = {
  [Column in keyof Schema as undefined extends CrdtColumnType<Schema[Column]>
    ? Column
    : never]?: Exclude<CrdtColumnType<Schema[Column]>, undefined> | null
} & {
  [Column in keyof Schema as undefined extends CrdtColumnType<Schema[Column]>
    ? never
    : Column]: CrdtColumnType<Schema[Column]>
}

/**
 * Fields accepted by {@link CrdtTable#create}. Columns wrapped in
 * {@link optional} or having `default` can be omitted.
 */
export type CrdtCreateFields<Schema extends CrdtTableSchema> = {
  [Column in keyof Schema as Schema[Column] extends CrdtColumn<any, false>
    ? Column
    : never]?: Exclude<CrdtColumnType<Schema[Column]>, undefined>
} & {
  [Column in keyof Schema as Schema[Column] extends CrdtColumn<any, false>
    ? never
    : Column]: CrdtColumnType<Schema[Column]>
}

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
 */
export type CrdtTableRow<Schema extends CrdtTableSchema> = {
  id: string

  /**
   * JSON string with Logux Meta ID of the last action which changed
   * every field. It is used to resolve conflicts with per-field
   * last write wins.
   */
  updatedAt: string
} & {
  [Column in keyof Schema]: undefined extends CrdtColumnType<Schema[Column]>
    ? Exclude<CrdtColumnType<Schema[Column]>, undefined> | null
    : CrdtColumnType<Schema[Column]>
}

export interface CrdtTable<
  Schema extends CrdtTableSchema = CrdtTableSchema,
  Dialect extends string = 'sqlite'
> {
  /**
   * Add `plural/created` action to the log. The table row will be inserted
   * by the reducer (in a single browser tab) when the action is processed.
   *
   * @param fields Row fields. `id` will be generated if omitted.
   * @returns Promise with row ID resolved when action was added to the log.
   */
  create(fields: { id?: string } & CrdtCreateFields<Schema>): Promise<string>

  /**
   * Add `plural/deleted` action to the log to remove the row.
   *
   * @param id Row ID.
   * @returns Promise resolved when action was added to the log.
   */
  delete(id: string): Promise<void>

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
   * last write wins by `updatedAt` values. Changes of rows deleted
   * on another client are ignored.
   *
   * Set optional field to `null` to clear its value. `undefined` fields
   * are not changed (JSON, used to sync actions, has no `undefined`).
   *
   * @param id Row ID.
   * @param diff Changed fields.
   * @returns Promise resolved when action was added to the log.
   */
  update(id: string, diff: Partial<CrdtRowFields<Schema>>): Promise<void>
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
   * Database preparing status:
   *
   * - `initializing`: reading schema version, checking tables.
   * - `updating`: schema was changed, tables are being dropped and refilled
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
   * @param plural Table name and actions type prefix.
   * @param schema Columns definition from {@link string}, {@link number},
   *               {@link bigint}, {@link boolean}, {@link oneOf},
   *               {@link optional} builders. {@link boolean} is not
   *               allowed with `'sqlite'` dialect.
   */
  table<
    Schema extends CrdtTableSchema<
      Dialect extends 'sqlite'
        ? Exclude<CrdtColumn['type'], 'BOOLEAN'>
        : CrdtColumn['type']
    >
  >(
    plural: string,
    schema: Schema
  ): CrdtTable<Schema, Dialect>
}

export type Dialects = 'sqlite' | 'pglite'

/**
 * Create CRDT LWW Map tables on top of SQL database filled from Logux log.
 *
 * Tables are filled by reducing actions from the log in a single browser
 * tab (like {@link createReducer}). {@link CrdtTable#create},
 * {@link CrdtTable#update} and {@link CrdtTable#delete} only add actions
 * to the log; the reducer applies them to the database.
 *
 * Actions are the same as in {@link syncMapTemplate}
 * (`user/created`, `user/changed`, `user/deleted` from `@logux/actions`),
 * so tables are compatible with existing Logux servers and can be mixed
 * with `syncMapTemplate` stores on other clients.
 *
 * Each table has extra `id` and `updatedAt` columns. `updatedAt` keeps JSON
 * with the last change time of every field to resolve edit conflicts with
 * per-field last write wins strategy.
 *
 * The schema version — serialized schemas of all tables — is kept in
 * `localStorage`. On any schema change all tables (including tables
 * removed from the schema) are dropped and refilled by replaying actions
 * from the log and from the `repeat()` callback.
 *
 * ```ts
 * import { openDb, sqlocalDriver } from '@nanostores/sql'
 * import {
 *   bigint, createCrdtDatabase, number, oneOf, optional, string
 * } from '@logux/client/db'
 *
 * let db = openDb(sqlocalDriver('app.sqlite'))
 * let crdt = createCrdtDatabase(client, db, {
 *   async repeat() {
 *     return await fetchActionsSnapshot()
 *   },
 *   stop() {
 *     updateAppWarning.show()
 *   }
 * })
 *
 * let user = crdt.table('user', {
 *   age: optional(number()),
 *   createdAt: bigint({ default: () => Date.now() }),
 *   email: string('COLLATE NOCASE'),
 *   isAdmin: number({ default: 0 }),
 *   name: string(),
 *   theme: oneOf(['dark', 'light'], { default: 'dark' })
 * })
 *
 * let id = await user.create({ email: 'ann@example.com', name: 'Ann' })
 * await user.update(id, { age: 30 })
 * let $admins = user.select`WHERE "isAdmin" = ${1} ORDER BY "name"`
 * await user.delete(id)
 * ```
 *
 * @param client Logux client.
 * @param db SQL database from `@nanostores/sql` `openDb()`.
 * @param opts Old actions source and outdated schema callbacks.
 */
export function createCrdtDatabase<Dialect extends Dialects = 'sqlite'>(
  client: Client,
  db: Database,
  opts?: CrdtDatabaseOptions<Dialect>
): CrdtDatabase<Dialect>
