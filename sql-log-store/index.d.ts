import type { ActionPackerMap } from '@logux/actions'
import type { AnyAction, LogStore, Meta } from '@logux/core'
import type { Database } from '@nanostores/sql'

export interface SqlLogStoreOptions<Packers = Record<string, never>> {
  /**
   * Packers to keep the binary parts of the actions in a separate column
   * instead of Base64 inside the JSON.
   *
   * ```js
   * import { zeroPacker } from '@logux/actions'
   *
   * const store = new SqlLogStore(db, { packers: { '0': zeroPacker } })
   * ```
   */
  packers?: Packers
}

/**
 * SQL store for Logux log on top of `@nanostores/sql` database.
 *
 * It works with any driver of `@nanostores/sql`: SQLite in the browser
 * by SQLocal, PGlite, Expo SQLite in React Native, or Node.js SQLite
 * in tests.
 *
 * ```js
 * import { CrossTabClient } from '@logux/client'
 * import { SqlLogStore } from '@logux/client/db'
 * import { openDb } from '@nanostores/sql'
 * import { sqlocalDriver } from '@nanostores/sql/sqlocal'
 *
 * const db = openDb(sqlocalDriver('app.sqlite'))
 * const client = new CrossTabClient({
 *   …,
 *   store: new SqlLogStore(db)
 * })
 * ```
 *
 * The store keeps actions in `logux_log`, `logux_reason`, `logux_index`,
 * and `logux_extra` tables. They will be created on the first query.
 *
 * Version of the tables format is kept in `logux_version` table.
 * If the database was created by a newer version of the client,
 * all methods will throw an error.
 */
export class SqlLogStore<
  Packers extends ActionPackerMap<Packers> = Record<string, never>
> extends LogStore {
  /**
   * @param db Database from `@nanostores/sql` `openDb()`.
   * @param opts Store options.
   */
  constructor(db: Database, opts?: SqlLogStoreOptions<Packers>)

  /**
   * Set the callback, which will be called inside the transaction writing
   * the action to the log. It allows to apply the action to the tables
   * of the same database atomically: the action and its result will be
   * committed together, and `await` of `log.add()` will mean that
   * the tables were already changed.
   *
   * {@link createCrdtDatabase} sets it automatically, if the log
   * and the CRDT tables are in the same database.
   *
   * An error in the callback rolls back the whole transaction,
   * so the action will not be added to the log.
   *
   * @param callback Callback or `undefined` to remove the previous one.
   */
  onTransactionAdd(
    callback:
      | ((tx: Database, action: AnyAction, meta: Meta) => Promise<void> | void)
      | undefined
  ): void
}
