import { isFirstOlder, toSorted } from '@logux/core'

export function newerDatabaseError(part) {
  let error = new Error(`${part} from a newer Logux Client`)
  error.name = 'LoguxNewerDatabase'
  return error
}

/**
 * Version of the internal tables format to re-create the log on changes.
 * It can only grow, so the log from a newer client is not supported.
 */
const LOGUX_SQL_LOG_VERSION = 1

const TABLES = ['logux_log', 'logux_reason', 'logux_index', 'logux_extra']

const DDL = [
  `CREATE TABLE IF NOT EXISTS "logux_log" (` +
    `"added" BIGINT PRIMARY KEY, "id" TEXT UNIQUE, "sorted" TEXT,` +
    ` "action" TEXT, "meta" TEXT)`,
  `CREATE TABLE IF NOT EXISTS "logux_reason" (` +
    `"added" BIGINT, "reason" TEXT, PRIMARY KEY ("added", "reason"))`,
  `CREATE INDEX IF NOT EXISTS "logux_reason_reason"` +
    ` ON "logux_reason" ("reason")`,
  `CREATE TABLE IF NOT EXISTS "logux_index" (` +
    `"added" BIGINT, "name" TEXT, PRIMARY KEY ("added", "name"))`,
  `CREATE INDEX IF NOT EXISTS "logux_index_name" ON "logux_index" ("name")`,
  `CREATE TABLE IF NOT EXISTS "logux_extra" (` +
    `"key" TEXT PRIMARY KEY, "value" BIGINT)`
]

const SYNCED = ['received', 'sent']

/**
 * How many actions to load in a single `get()` page.
 */
const PAGE_SIZE = 1000

/**
 * How many times to repeat a transaction, which was locked by another tab
 * writing to the same database.
 */
const RETRIES = 5

async function addTags(target, table, column, added, values) {
  for (let value of values ?? []) {
    await target.exec(
      `INSERT INTO "${table}" ("added", "${column}") VALUES (?, ?)`,
      [added, value]
    )
  }
}

function holders(count) {
  return Array(count).fill('?').join(', ')
}

/**
 * Another tab can keep the write lock, and SQLite drivers have no timeout
 * to wait for it, so we will just repeat the transaction.
 */
function isLocked(error) {
  let text = `${error.code} ${error.message}`
  return text.includes('SQLITE_BUSY') || text.includes('database is locked')
}

/**
 * Actions can keep binary data from `encryptActions()`, so `Uint8Array`
 * is marked by `$bytes` key in JSON.
 */
function parseJSONWithBinary(json) {
  return JSON.parse(json, (key, value) => {
    if (value && value.$bytes) return Uint8Array.from(value.$bytes)
    return value
  })
}

async function removeEntries(target, added) {
  for (let table of ['logux_log', 'logux_reason', 'logux_index']) {
    await target.exec(
      `DELETE FROM "${table}" WHERE "added" IN (${holders(added.length)})`,
      added
    )
  }
}

function serializeToJSONWithBinary(data) {
  return JSON.stringify(data, (key, value) => {
    if (value instanceof Uint8Array) return { $bytes: Array.from(value) }
    return value
  })
}

function toEntry(row) {
  let meta = parseJSONWithBinary(row.meta)
  meta.added = Number(row.added)
  return [parseJSONWithBinary(row.action), meta]
}

function matchTime(meta, criteria) {
  if (criteria.olderThan && !isFirstOlder(meta, criteria.olderThan)) {
    return false
  }
  if (criteria.youngerThan && !isFirstOlder(criteria.youngerThan, meta)) {
    return false
  }
  return true
}

async function selectByCriteria(target, criteria, reasons) {
  let where = []
  let params = []
  if (reasons) {
    where.push(
      `"added" IN (SELECT "added" FROM "logux_reason"` +
        ` WHERE "reason" IN (${holders(reasons.length)}))`
    )
    params.push(...reasons)
  }
  if (criteria.index !== undefined) {
    where.push(
      `"added" IN (SELECT "added" FROM "logux_index" WHERE "name" = ?)`
    )
    params.push(criteria.index)
  }
  if (criteria.exceptIndex !== undefined) {
    where.push(
      `"added" NOT IN (SELECT "added" FROM "logux_index" WHERE "name" = ?)`
    )
    params.push(criteria.exceptIndex)
  }
  if (criteria.id !== undefined) {
    where.push('"id" = ?')
    params.push(criteria.id)
  }
  if (criteria.ids !== undefined) {
    where.push(`"id" IN (${holders(criteria.ids.length)})`)
    params.push(...criteria.ids)
  }
  if (criteria.minAdded !== undefined) {
    where.push('"added" >= ?')
    params.push(criteria.minAdded)
  }
  if (criteria.maxAdded !== undefined) {
    where.push('"added" <= ?')
    params.push(criteria.maxAdded)
  }
  return target.select(
    `SELECT "added", "action", "meta" FROM "logux_log"` +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY "added"`,
    params
  )
}

export class SqlLogStore {
  constructor(db) {
    this.db = db
    this.driver = db.driver
    this.queue = Promise.resolve()
  }

  async add(action, meta) {
    return this.write(async tx => {
      let [exist] = await tx.driver.select(
        `SELECT "added" FROM "logux_log" WHERE "id" = ?`,
        [meta.id]
      )
      if (exist) return false

      // Next `added` is taken by SQL inside the immediate transaction
      // to be safe with other tabs writing to the same database
      let [{ last }] = await tx.driver.select(
        `SELECT coalesce(max("added"), 0) AS "last" FROM "logux_log"`,
        []
      )
      meta.added = Number(last) + 1

      await tx.driver.exec(
        `INSERT INTO "logux_log"` +
          ` ("added", "id", "sorted", "action", "meta")` +
          ` VALUES (${holders(5)})`,
        [
          meta.added,
          meta.id,
          toSorted(meta),
          serializeToJSONWithBinary(action),
          serializeToJSONWithBinary(meta)
        ]
      )
      await addTags(
        tx.driver,
        'logux_reason',
        'reason',
        meta.added,
        meta.reasons
      )
      await addTags(tx.driver, 'logux_index', 'name', meta.added, meta.indexes)
      // Materialized views commit together with the action
      if (this.onAdd) await this.onAdd(tx, action, meta)
      return meta
    })
  }

  async byId(id) {
    await this.init()
    let [row] = await this.driver.select(
      `SELECT "added", "action", "meta" FROM "logux_log" WHERE "id" = ?`,
      [id]
    )
    return row ? toEntry(row) : [null, null]
  }

  async changeMeta(id, diff) {
    return this.write(async tx => {
      let [row] = await tx.driver.select(
        `SELECT "added", "meta" FROM "logux_log" WHERE "id" = ?`,
        [id]
      )
      if (!row) return false

      let meta = parseJSONWithBinary(row.meta)
      for (let key in diff) meta[key] = diff[key]
      await tx.driver.exec(
        `UPDATE "logux_log" SET "meta" = ? WHERE "added" = ?`,
        [serializeToJSONWithBinary(meta), row.added]
      )
      if (diff.reasons) {
        await tx.driver.exec(`DELETE FROM "logux_reason" WHERE "added" = ?`, [
          row.added
        ])
        await addTags(
          tx.driver,
          'logux_reason',
          'reason',
          row.added,
          diff.reasons
        )
      }
      return true
    })
  }

  async clean() {
    await this.write(async tx => {
      for (let table of TABLES) {
        await tx.driver.exec(`DELETE FROM "${table}"`, [])
      }
    })
  }

  async get(opts = {}) {
    await this.init()
    return this.page(opts)
  }

  async getLastAdded() {
    await this.init()
    let [{ last }] = await this.driver.select(
      `SELECT coalesce(max("added"), 0) AS "last" FROM "logux_log"`,
      []
    )
    return Number(last)
  }

  async getLastSynced() {
    await this.init()
    let rows = await this.driver.select(
      `SELECT "key", "value" FROM "logux_extra"`,
      []
    )
    let synced = { received: 0, sent: 0 }
    for (let row of rows) synced[row.key] = Number(row.value)
    return synced
  }

  init() {
    if (!this.initing) {
      this.initing = this.transaction(async tx => {
        // Format of this table will never change, so we can read it
        // before we will know the version of other tables
        await tx.driver.exec(
          `CREATE TABLE IF NOT EXISTS "logux_version" ("version" BIGINT)`,
          []
        )
        let [row] = await tx.driver.select(
          `SELECT "version" FROM "logux_version"`,
          []
        )
        let version = row ? Number(row.version) : 0
        if (version > LOGUX_SQL_LOG_VERSION) {
          throw newerDatabaseError('Log')
        }
        if (version < LOGUX_SQL_LOG_VERSION) {
          await tx.driver.exec(`DELETE FROM "logux_version"`, [])
          await tx.driver.exec(
            `INSERT INTO "logux_version" ("version") VALUES (?)`,
            [LOGUX_SQL_LOG_VERSION]
          )
        }
        for (let sql of DDL) await tx.driver.exec(sql, [])
      })
    }
    return this.initing
  }

  /**
   * Pages are loaded from the newest actions to the oldest ones by keyset
   * pagination, so a big log will not be loaded into the memory at once.
   */
  async page(opts, cursor) {
    let created = opts.order === 'created'
    let where = []
    let params = []
    if (opts.index) {
      where.push(
        `"added" IN (SELECT "added" FROM "logux_index" WHERE "name" = ?)`
      )
      params.push(opts.index)
    }
    if (opts.reason) {
      where.push(
        `"added" IN (SELECT "added" FROM "logux_reason" WHERE "reason" = ?)`
      )
      params.push(opts.reason)
    }
    if (cursor) {
      where.push(
        created ? `("sorted", "added") < (${holders(2)})` : `"added" < ?`
      )
      params.push(...cursor)
    }
    let order = created ? `"sorted" DESC, "added" DESC` : `"added" DESC`
    let rows = await this.driver.select(
      `SELECT * FROM "logux_log"` +
        (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
        ` ORDER BY ${order} LIMIT ${PAGE_SIZE}`,
      params
    )
    rows.reverse()

    let page = { entries: rows.map(toEntry) }
    if (rows.length === PAGE_SIZE) {
      let oldest = rows[0]
      let next = created ? [oldest.sorted, oldest.added] : [oldest.added]
      page.next = () => this.page(opts, next)
    }
    return page
  }

  async remove(id) {
    return this.write(async tx => {
      let [row] = await tx.driver.select(
        `SELECT "added", "action", "meta" FROM "logux_log" WHERE "id" = ?`,
        [id]
      )
      if (!row) return false
      await removeEntries(tx.driver, [row.added])
      return toEntry(row)
    })
  }

  async addReason(reasons, criteria) {
    if (criteria.ids && criteria.ids.length === 0) return
    await this.write(async tx => {
      let rows = await selectByCriteria(tx.driver, criteria)
      for (let row of rows) {
        let [, meta] = toEntry(row)
        if (!matchTime(meta, criteria)) continue
        let missing = reasons.filter(i => !meta.reasons.includes(i))
        if (missing.length === 0) continue
        meta.reasons = meta.reasons.concat(missing)
        await tx.driver.exec(
          `UPDATE "logux_log" SET "meta" = ? WHERE "added" = ?`,
          [serializeToJSONWithBinary(meta), meta.added]
        )
        await addTags(tx.driver, 'logux_reason', 'reason', meta.added, missing)
      }
    })
  }

  async removeReason(reasons, criteria, callback) {
    if (criteria.ids && criteria.ids.length === 0) return
    // Callbacks are called after the commit, so they will not see
    // the database in the middle of the changes
    let cleaned = await this.write(async tx => {
      let rows = await selectByCriteria(tx.driver, criteria, reasons)
      let removed = []
      for (let row of rows) {
        let [action, meta] = toEntry(row)
        if (!matchTime(meta, criteria)) continue
        let dropping = reasons.filter(i => meta.reasons.includes(i))
        if (dropping.length === 0) continue
        meta.reasons = meta.reasons.filter(i => !dropping.includes(i))
        if (meta.reasons.length === 0) {
          removed.push([action, meta])
        } else {
          await tx.driver.exec(
            `UPDATE "logux_log" SET "meta" = ? WHERE "added" = ?`,
            [serializeToJSONWithBinary(meta), meta.added]
          )
          await tx.driver.exec(
            `DELETE FROM "logux_reason" WHERE "added" = ?` +
              ` AND "reason" IN (${holders(dropping.length)})`,
            [meta.added, ...dropping]
          )
        }
      }
      if (removed.length > 0) {
        await removeEntries(
          tx.driver,
          removed.map(entry => entry[1].added)
        )
      }
      return removed
    })
    for (let [action, meta] of cleaned) callback(action, meta)
  }

  onTransactionAdd(callback) {
    this.onAdd = callback
  }

  async setLastSynced(values) {
    await this.write(async tx => {
      for (let key of SYNCED) {
        if (values[key] !== undefined) {
          await tx.driver.exec(
            `INSERT INTO "logux_extra" ("key", "value") VALUES (?, ?)` +
              ` ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`,
            [key, values[key]]
          )
        }
      }
    })
  }

  async transaction(callback) {
    for (let i = 0; ; i++) {
      try {
        // Immediate transaction takes the write lock before our `SELECT`,
        // so another tab can’t change the data before our `INSERT`
        return await this.db.transaction(callback, { immediate: true })
      } catch (e) {
        if (i === RETRIES || !isLocked(e)) throw e
        // Give another tab a time to finish its transaction
        await new Promise(resolve => {
          setTimeout(resolve, i * 10)
        })
      }
    }
  }

  write(callback) {
    let result = this.queue.then(async () => {
      await this.init()
      return this.transaction(callback)
    })
    this.queue = result.catch(() => {})
    return result
  }
}
