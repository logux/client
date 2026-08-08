import type { LogStore } from '@logux/core'
import type { Database } from '@nanostores/sql'

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
 * On format changes in the new version of the client, tables will be
 * re-created and the log will be lost. If the database was created
 * by a newer version of the client, all methods will throw an error.
 */
export class SqlLogStore extends LogStore {
  /**
   * @param db Database from `@nanostores/sql` `openDb()`.
   */
  constructor(db: Database)
}
