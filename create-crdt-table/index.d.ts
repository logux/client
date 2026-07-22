import type { SyncMapTypes } from '@logux/actions'
import type { Action } from '@logux/core'
import type { Database, SqlStore } from '@nanostores/sql'
import type { ReadableAtom } from 'nanostores'

import type { Client, ClientMeta } from '../client/index.js'

type CrdtMigrationStatus = 'initializing' | 'outdated' | 'ready' | 'updating'

/**
 * JS types of column values. `Date` is serialized to a number
 * of milliseconds in actions.
 */
export type CrdtColumnValue = Date | SyncMapTypes

export interface CrdtColumnSql {
  /**
   * Extra column definition SQL for PGlite/PostgreSQL.
   */
  pglite?: string

  /**
   * Extra column definition SQL for SQLite.
   */
  sqlite?: string
}

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
   * or an object to set SQL per database dialect.
   */
  sql?: CrdtColumnSql | string
}

/**
 * Column definition created by {@link string}, {@link number},
 * {@link boolean}, {@link oneOf}, {@link date} and {@link optional}
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
  sql?: CrdtColumnSql | string
  type: 'boolean' | 'date' | 'number' | 'string'
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
): CrdtColumn<Type, true>
export function string<Type extends string = string>(
  opts: { default: NoInfer<Type> } & CrdtColumnOptions<Type>
): CrdtColumn<Type, false>

/**
 * `REAL`/`INTEGER` column with `number` value.
 *
 * @param opts Extra column definition SQL or column options.
 */
export function number<Type extends number = number>(
  opts?: Omit<CrdtColumnOptions<Type>, 'default'> | string
): CrdtColumn<Type, true>
export function number<Type extends number = number>(
  opts: { default: NoInfer<Type> } & CrdtColumnOptions<Type>
): CrdtColumn<Type, false>

/**
 * Boolean column. Takes `boolean` in {@link CrdtTable#create} and
 * {@link CrdtTable#update}, stored and returned in rows as `INTEGER`
 * `1`/`0`.
 *
 * @param opts Extra column definition SQL or column options.
 */
export function boolean(
  opts?: Omit<CrdtColumnOptions<boolean>, 'default'> | string
): CrdtColumn<boolean, true>
export function boolean(
  opts: { default: (() => boolean) | boolean } & CrdtColumnOptions<boolean>
): CrdtColumn<boolean, false>

/**
 * Enum column with union of string values. Stored as `TEXT` with `CHECK`
 * constraint in SQLite and as `ENUM` type in PGlite.
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
): CrdtColumn<Values[number], true>
export function oneOf<const Values extends readonly [string, ...string[]]>(
  values: Values,
  opts: {
    default: (() => Values[number]) | Values[number]
  } & CrdtColumnOptions<Values[number]>
): CrdtColumn<Values[number], false>

/**
 * Date and time column. Takes JS `Date` in {@link CrdtTable#create} and
 * {@link CrdtTable#update}, stored and returned in rows as `BIGINT`
 * number of milliseconds (also used in actions).
 *
 * ```ts
 * import { date } from '@logux/client/db'
 *
 * let schema = {
 *   createdAt: date({ default: () => new Date() }),
 *   publishedAt: optional(date())
 * }
 * ```
 *
 * @param opts Extra column definition SQL or column options.
 */
export function date(
  opts?: Omit<CrdtColumnOptions<Date>, 'default'> | string
): CrdtColumn<Date, true>
export function date(
  opts: { default: (() => Date) | Date } & CrdtColumnOptions<Date>
): CrdtColumn<Date, false>

/**
 * Mark column as optional. The field can be omitted in
 * {@link CrdtTable#create} and can be `undefined` (SQL `NULL`) in rows.
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
export function optional<Type extends CrdtColumnValue>(
  column: CrdtColumn<Type, boolean>
): CrdtColumn<Type | undefined, false>

export interface CrdtTableSchema {
  [column: string]: CrdtColumn
}

export type CrdtColumnType<Column extends CrdtColumn> =
  Column extends CrdtColumn<infer Type, boolean> ? Type : never

/**
 * Row fields (without `id` and `updatedAt`) inferred from table schema.
 */
export type CrdtRowFields<Schema extends CrdtTableSchema> = {
  [Column in keyof Schema as undefined extends CrdtColumnType<Schema[Column]>
    ? Column
    : never]?: Exclude<CrdtColumnType<Schema[Column]>, undefined>
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
 * Raw SQL value of the column in rows. Rows contain data as the database
 * driver returns it, without any conversion: `boolean` and `Date` columns
 * are numbers, missing optional columns are `null`. Exact values can
 * differ between database dialects.
 */
export type CrdtRawColumnValue<Type extends CrdtColumnValue> = Type extends
  | boolean
  | Date
  ? number
  : Type

/**
 * Table row returned by {@link CrdtTable#select} with raw SQL values
 * (see {@link CrdtRawColumnValue}).
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
    ?
        | CrdtRawColumnValue<
            Exclude<CrdtColumnType<Schema[Column]>, undefined>
          >
        | null
    : CrdtRawColumnValue<CrdtColumnType<Schema[Column]>>
}

export interface CrdtTable<Schema extends CrdtTableSchema = CrdtTableSchema> {
  /**
   * Add `plural/create` action to the log. The table row will be inserted
   * by the reducer (in a single browser tab) when the action is processed.
   *
   * @param fields Row fields. `id` will be generated if omitted.
   * @returns Promise with row ID resolved when action was added to the log.
   */
  create(fields: { id?: string } & CrdtCreateFields<Schema>): Promise<string>

  /**
   * Add `plural/delete` action to the log to remove the row.
   *
   * @param id Row ID.
   * @returns Promise resolved when action was added to the log.
   */
  delete(id: string): Promise<void>

  /**
   * Table name. It is used as SQL table name and as prefix
   * of action types (`user/create`, `user/change`, `user/delete`).
   */
  readonly plural: string

  /**
   * Reactive SQL query to the table. Use it as a template string tag
   * (like `db.store` in Nano Stores SQL); interpolated values are passed
   * as bound SQL parameters.
   *
   * The SQL is appended to `SELECT "plural".* FROM "plural"`,
   * so it can contain `WHERE`, `ORDER BY`, `LIMIT`, and even `JOIN`
   * to filter rows by other tables (only this table’s columns are
   * returned; use {@link CrdtDatabase#sql} to select joined columns).
   *
   * ```ts
   * let $all = user.select()
   * let $admins = user.select`WHERE "isAdmin" = ${true} ORDER BY "name"`
   * let $authors = user.select`
   *   JOIN "post" ON "post"."authorId" = "user"."id"
   *   WHERE "post"."draft" = ${false}
   * `
   * ```
   *
   * @param sql SQL template after `SELECT "table".* FROM "table"`.
   *            Omit to select all rows.
   * @param params Interpolated template values.
   */
  select(
    sql?: TemplateStringsArray,
    ...params: CrdtColumnValue[]
  ): SqlStore<CrdtTableRow<Schema>[]>

  /**
   * Add `plural/change` action to the log with changed fields.
   * Conflicts with parallel changes are resolved with per-field
   * last write wins by `updatedAt` values.
   *
   * @param id Row ID.
   * @param diff Changed fields.
   * @returns Promise resolved when action was added to the log.
   */
  update(id: string, diff: Partial<CrdtRowFields<Schema>>): Promise<void>
}

export interface CrdtDatabaseCallbacks {
  /**
   * SQL dialect of the database to choose per-dialect column SQL
   * from {@link CrdtColumnSql}. Default is `sqlite`.
   */
  dialect?: 'pglite' | 'sqlite'

  /**
   * `localStorage` key to store the schema version hash
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

export interface CrdtDatabase {
  /**
   * Reactive query with manual SQL. Use it for `JOIN` between tables,
   * aggregations and other queries which cannot be expressed with
   * {@link CrdtTable#select}.
   *
   * Use it as a template string tag (like `db.store` in Nano Stores SQL);
   * interpolated values are passed as bound SQL parameters. Rows contain
   * raw SQL values as the driver returns them
   * (see {@link CrdtRawColumnValue}); pass the row type as a generic
   * to type them.
   *
   * ```ts
   * let $count = crdt.sql<{ posts: number }>`
   *   SELECT COUNT(*) AS "posts" FROM "post"
   * `
   * let $feed = crdt.sql<{ author: string; publishedAt: number }>`
   *   SELECT "user"."name" AS "author", "post"."publishedAt"
   *   FROM "post" JOIN "user" ON "user"."id" = "post"."authorId"
   *   WHERE "post"."publishedAt" > ${new Date(2026, 0, 1)}
   * `
   * ```
   *
   * @param sql Full SQL query template.
   * @param params Interpolated template values.
   */
  sql<Row = Record<string, SyncMapTypes>>(
    sql: TemplateStringsArray,
    ...params: CrdtColumnValue[]
  ): SqlStore<Row[]>

  /**
   * Database preparing status:
   *
   * - `initializing`: reading schema version, checking tables.
   * - `updating`: schema was changed, tables are being dropped and refilled
   *   from the log and {@link CrdtDatabaseCallbacks#repeat}.
   * - `ready`: tables can be used.
   * - `outdated`: another tab has a newer schema, this tab must be reloaded.
   */
  status: ReadableAtom<CrdtMigrationStatus>

  /**
   * Define CRDT table in the database.
   *
   * All tables must be defined synchronously after
   * {@link createCrdtDatabase} call, because the schema version hash
   * is calculated from all tables.
   *
   * @param plural Table name and actions type prefix.
   * @param schema Columns definition from {@link string}, {@link number},
   *               {@link boolean}, {@link oneOf}, {@link date},
   *               {@link optional} builders.
   */
  table<Schema extends CrdtTableSchema>(
    plural: string,
    schema: Schema
  ): CrdtTable<Schema>
}

/**
 * Create CRDT LWW Map tables on top of SQL database filled from Logux log.
 *
 * Tables are filled by reducing actions from the log in a single browser
 * tab (like {@link createReducer}). {@link CrdtTable#create},
 * {@link CrdtTable#update} and {@link CrdtTable#delete} only add actions
 * to the log; the reducer applies them to the database.
 *
 * Actions are the same as in {@link syncMapTemplate}
 * (`user/create`, `user/change`, `user/delete` from `@logux/actions`),
 * so tables are compatible with existing Logux servers and can be mixed
 * with `syncMapTemplate` stores on other clients.
 *
 * Each table has extra `id` and `updatedAt` columns. `updatedAt` keeps JSON
 * with the last change time of every field to resolve edit conflicts with
 * per-field last write wins strategy.
 *
 * The schema version is a hash of all tables’ schemas kept in
 * `localStorage`. On any schema change the tables are dropped and refilled
 * by replaying actions from the log and from the `repeat()` callback.
 *
 * ```ts
 * import { openDb, sqlocalDriver } from '@nanostores/sql'
 * import {
 *   boolean, createCrdtDatabase, date, number, oneOf, optional, string
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
 *   createdAt: date({ default: () => new Date() }),
 *   email: string('COLLATE NOCASE'),
 *   isAdmin: boolean({ default: false }),
 *   name: string(),
 *   theme: oneOf(['dark', 'light'], { default: 'dark' })
 * })
 *
 * let id = await user.create({ email: 'ann@example.com', name: 'Ann' })
 * await user.update(id, { age: 30 })
 * let $admins = user.select`WHERE "isAdmin" = ${true} ORDER BY "name"`
 * await user.delete(id)
 * ```
 *
 * @param client Logux client.
 * @param db SQL database from `@nanostores/sql` `openDb()`.
 * @param callbacks Old actions source and outdated schema callbacks.
 */
export function createCrdtDatabase(
  client: Client,
  db: Database,
  callbacks?: CrdtDatabaseCallbacks
): CrdtDatabase
