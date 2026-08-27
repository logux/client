import { idToTime, toSorted } from '@logux/core'

export function newerDatabaseError(part) {
  let error = new Error(`${part} from a newer Logux Client`)
  error.name = 'LoguxNewerDatabase'
  return error
}

function noPackerError(type) {
  let error = new Error(`No packer for ${type}`)
  error.name = 'LoguxNoPacker'
  return error
}

const TABLES = ['logux_log', 'logux_reason', 'logux_index', 'logux_extra']

const MIGRATIONS = [
  [
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
  ],
  [
    `ALTER TABLE "logux_log" ADD COLUMN "blob" BYTEA`,
    `CREATE INDEX IF NOT EXISTS "logux_log_sorted"` +
      ` ON "logux_log" ("sorted", "added")`,
    `INSERT INTO "logux_extra" ("key", "value") VALUES ('added', 0)`
  ]
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
  if (!json.includes('"$bytes"')) return JSON.parse(json)
  return JSON.parse(json, (key, value) => {
    if (value && typeof value.$bytes === 'string') {
      return Uint8Array.from(atob(value.$bytes), char => char.charCodeAt(0))
    }
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
    if (value instanceof Uint8Array) {
      let binary = ''
      for (let byte of value) binary += String.fromCharCode(byte)
      return { $bytes: btoa(binary) }
    }
    return value
  })
}

function toMeta(row) {
  let meta = parseJSONWithBinary(row.meta)
  meta.added = Number(row.added)
  return meta
}

function position(meta) {
  if (typeof meta === 'string') meta = { id: meta, time: idToTime(meta) }
  return toSorted({ ...meta, time: meta.time ?? 0 })
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
  if (criteria.olderThan) {
    where.push('"sorted" < ?')
    params.push(position(criteria.olderThan))
  }
  if (criteria.youngerThan) {
    where.push('"sorted" > ?')
    params.push(position(criteria.youngerThan))
  }
  return target.select(
    `SELECT "added", "action", "meta", "blob" FROM "logux_log"` +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY "added"`,
    params
  )
}

export class SqlLogStore {
  constructor(db, opts = {}) {
    this.db = db
    this.driver = db.driver
    this.queue = Promise.resolve()
    this.packers = opts.packers ?? {}
  }

  async add(action, meta) {
    return this.write(async tx => {
      let [exist] = await tx.driver.select(
        `SELECT "added" FROM "logux_log" WHERE "id" = ?`,
        [meta.id]
      )
      if (exist) return false

      let [{ next }] = await tx.driver.select(
        `UPDATE "logux_extra" SET "value" = "value" + 1` +
          ` WHERE "key" = 'added' RETURNING "value" AS "next"`,
        []
      )
      meta.added = Number(next)

      let blob = null
      let body = action
      let packer = this.packers[action.type]
      if (packer) {
        let packed = packer.pack(action)
        if (packed) {
          blob = packed.blob
          body = packed.action
        }
      }

      await tx.driver.exec(
        `INSERT INTO "logux_log"` +
          ` ("added", "id", "sorted", "action", "meta", "blob")` +
          ` VALUES (${holders(6)})`,
        [
          meta.added,
          meta.id,
          toSorted(meta),
          serializeToJSONWithBinary(body),
          serializeToJSONWithBinary(meta),
          blob
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
      `SELECT "added", "action", "meta", "blob" FROM "logux_log"` +
        ` WHERE "id" = ?`,
      [id]
    )
    return row ? this.toEntry(row) : [null, null]
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
      // The counter can be reset only together with `sent` and `received`
      await tx.driver.exec(
        `INSERT INTO "logux_extra" ("key", "value") VALUES ('added', 0)`,
        []
      )
    })
  }

  async get(opts = {}) {
    await this.init()
    return this.page(opts)
  }

  async getLastAdded() {
    await this.init()
    let [row] = await this.driver.select(
      `SELECT "value" FROM "logux_extra" WHERE "key" = 'added'`,
      []
    )
    return Number(row.value)
  }

  async getLastSynced() {
    await this.init()
    let rows = await this.driver.select(
      `SELECT "key", "value" FROM "logux_extra"` +
        ` WHERE "key" IN (${holders(SYNCED.length)})`,
      SYNCED
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
        if (version > MIGRATIONS.length) {
          throw newerDatabaseError('Log')
        }
        if (version === MIGRATIONS.length) return

        for (let migration of MIGRATIONS.slice(version)) {
          for (let sql of migration) await tx.driver.exec(sql, [])
        }
        await tx.driver.exec(`DELETE FROM "logux_version"`, [])
        await tx.driver.exec(
          `INSERT INTO "logux_version" ("version") VALUES (?)`,
          [MIGRATIONS.length]
        )
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

    let page = { entries: rows.map(this.toEntry, this) }
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
        `SELECT "added", "action", "meta", "blob" FROM "logux_log"` +
          ` WHERE "id" = ?`,
        [id]
      )
      if (!row) return false
      await removeEntries(tx.driver, [row.added])
      return this.toEntry(row)
    })
  }

  async addReason(reasons, criteria) {
    if (criteria.ids && criteria.ids.length === 0) return
    await this.write(async tx => {
      let rows = await selectByCriteria(tx.driver, criteria)
      for (let row of rows) {
        // The action is not touched here, so it is not unpacked
        let meta = toMeta(row)
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
        let meta = toMeta(row)
        let dropping = reasons.filter(i => meta.reasons.includes(i))
        if (dropping.length === 0) continue
        meta.reasons = meta.reasons.filter(i => !dropping.includes(i))
        if (meta.reasons.length === 0) {
          removed.push([this.toEntry(row)[0], meta])
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

  toEntry(row) {
    let meta = toMeta(row)
    let action = parseJSONWithBinary(row.action)
    if (row.blob) {
      let packer = this.packers[action.type]
      if (!packer) throw noPackerError(action.type)
      action = packer.unpack({ action, blob: row.blob })
    }
    return [action, meta]
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
