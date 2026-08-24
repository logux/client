import { sortedToMeta, toSorted } from '@logux/core'
import { createNanoEvents } from 'nanoevents'
import { nanoid } from 'nanoid'
import { atom } from 'nanostores'

import { newerDatabaseError } from '../sql-log-store/index.js'

function column(type, opts = {}) {
  if (typeof opts === 'string') opts = { sql: opts }
  return { required: !('default' in opts), type, ...opts }
}

export function string(opts) {
  return column('TEXT', opts)
}

export function number(opts) {
  return column('DOUBLE PRECISION', opts)
}

export function boolean(opts) {
  return column('BOOLEAN', opts)
}

export function bigint(opts) {
  return column('BIGINT', opts)
}

export function oneOf(values, opts) {
  return { ...column('TEXT', opts), values }
}

export function optional(col) {
  return { ...col, nullable: true, required: false }
}

/**
 * Prefix of columns with sortable meta of the last change of every field
 * for CRDT LWW.
 */
const META = 'updatedAt_'

export function withoutMeta(rows) {
  return rows.map(row => {
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => !key.startsWith(META))
    )
  })
}

export function withMeta(row) {
  let meta = {}
  for (let key of Object.keys(row)) {
    if (key !== 'id') meta[`${META}${key}`] = null
  }
  return { ...row, ...meta }
}

export async function crdtTableToActions(tables) {
  let all = []
  for (let { driver, plural, schema } of tables) {
    let rows = await driver.select(
      `SELECT * FROM "${plural}" ORDER BY "id"`,
      []
    )
    // Cells of all rows grouped by the meta of their last change
    let cells = new Map()
    // The oldest meta of every row becomes its created action
    let oldest = new Map()
    for (let row of rows) {
      for (let key in schema) {
        let sorted = row[`${META}${key}`]
        if (!sorted) continue
        let metaRows = cells.get(sorted)
        if (!metaRows) {
          metaRows = new Map()
          cells.set(sorted, metaRows)
        }
        let fields = metaRows.get(row.id)
        if (!fields) {
          fields = {}
          metaRows.set(row.id, fields)
        }
        fields[key] = row[key]
        let min = oldest.get(row.id)
        if (!min || sorted < min) oldest.set(row.id, sorted)
      }
    }
    for (let [sorted, metaRows] of cells) {
      let created = false
      for (let id of metaRows.keys()) {
        if (oldest.get(id) === sorted) created = true
      }
      let action
      if (metaRows.size === 1) {
        let [id, fields] = metaRows.entries().next().value
        action = {
          fields,
          id,
          type: `${plural}/${created ? 'created' : 'changed'}`
        }
      } else if (created) {
        // Rows with older cells already exist on the replay,
        // so the created action only updates them
        let records = []
        for (let [id, fields] of metaRows) records.push({ id, ...fields })
        action = { records, type: `${plural}/created` }
      } else {
        // A changed batch wrote the same values to every row, so the union
        // of the survived cells restores the original fields
        let fields = {}
        let ids = []
        for (let [id, survived] of metaRows) {
          ids.push(id)
          Object.assign(fields, survived)
        }
        action = { fields, ids, type: `${plural}/changed` }
      }
      all.push([sorted, action])
    }
  }
  // The replay must create the row before applying its changed actions
  all.sort((a, b) => {
    if (a[0] < b[0]) return -1
    if (a[0] > b[0]) return 1
    return 0
  })
  return all.map(([sorted, action]) => [action, sortedToMeta(sorted)])
}

/**
 * Version of the internal database format to update database on changes.
 */
const LOGUX_CRDT_TABLE_VERSION = 1

function columnSql(name, col, dialect) {
  let sql = `"${name}" ${col.type}`
  if (col.values) {
    let values = col.values.map(i => `'${i.replaceAll("'", "''")}'`)
    sql += ` CHECK ("${name}" IN (${values.join(', ')}))`
  }
  let extra = col.sql
  if (extra && typeof extra === 'object') extra = extra[dialect]
  if (extra) sql += ` ${extra}`
  return sql
}

/**
 * Table with the service data of the Logux itself: `schema` with the hash
 * of this database and `version` with the format of the tables.
 */
const SERVICE = 'logux_crdt'

async function readService(target, key) {
  let rows = await target.select(
    `SELECT "value" FROM "${SERVICE}" WHERE "key" = ?`,
    [key]
  )
  return rows[0]?.value
}

function writeService(target, key, value) {
  return target.exec(
    `INSERT INTO "${SERVICE}" ("key", "value") VALUES (?, ?)` +
      ` ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`,
    [key, value]
  )
}

function createTableSql(plural, schema, dialect) {
  let columns = ['"id" TEXT PRIMARY KEY']
  let metas = []
  for (let name in schema) {
    columns.push(columnSql(name, schema[name], dialect))
    metas.push(`"${META}${name}" TEXT`)
  }
  return (
    `CREATE TABLE IF NOT EXISTS "${plural}"` +
    ` (${columns.concat(metas).join(', ')})`
  )
}

function indexSql(plural, schema, index, names) {
  if (index.sql) return index.sql
  let columns = index.columns ?? index
  if (typeof columns === 'string') columns = [columns]
  let name = plural
  let parts = []
  for (let col of columns) {
    // Everything after the column name (`DESC`, `COLLATE`, operator class)
    // is passed to the database as is
    let space = col.indexOf(' ')
    let head = space === -1 ? col : col.slice(0, space)
    let field = head.startsWith(META) ? head.slice(META.length) : head
    if (head !== 'id' && !schema[field]) {
      throw new Error(`Unknown column "${head}" in "${plural}" index`)
    }
    name += `_${head}`
    parts.push(`"${head}"${space === -1 ? '' : col.slice(space)}`)
  }
  // `IF NOT EXISTS` would silently skip the second index with the same name
  if (names.has(name)) {
    throw new Error(`Duplicate index name "${name}"`)
  }
  names.add(name)
  return (
    `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${name}"` +
    ` ON "${plural}" (${parts.join(', ')})`
  )
}

/**
 * How many actions to apply in a single transaction.
 */
const CHUNK_SIZE = 1000

/**
 * The last write to every connection: two databases can share a connection,
 * where a transaction can not be started inside another one.
 */
const WRITES = new WeakMap()

/**
 * How long to keep the apply lock after the last write before another tab
 * can take it.
 */
const APPLY_LOCK_IDLE = 300

const VERBS = new Set(['changed', 'created', 'deleted'])

export function parseCrdtType(type, crdt) {
  let slash = type.lastIndexOf('/')
  if (slash === -1) return false
  let plural = type.slice(0, slash)
  let verb = type.slice(slash + 1)
  if (!Object.hasOwn(crdt.tables, plural) || !VERBS.has(verb)) return false
  return { plural, verb }
}

export function parseCrdtRows(action) {
  if (action.records) return action.records.map(fields => [fields.id, fields])
  return (action.ids ?? [action.id]).map(id => [id, action.fields])
}

export function parseCrdtAction(action, crdt) {
  let parsed = parseCrdtType(action.type, crdt)
  if (!parsed) return false
  let schema = crdt.tables[parsed.plural]
  parsed.rows = parseCrdtRows(action).map(([id, fields]) => {
    let names = []
    for (let key in fields) {
      if (schema[key] && fields[key] !== undefined) names.push(key)
    }
    return [id, names]
  })
  return parsed
}

function holders(count) {
  return '?, '.repeat(count - 1) + '?'
}

async function execAll(target, queries) {
  for (let query of queries) {
    await target.exec(query[0], query[1])
  }
}

function blockClosing(e) {
  e.returnValue = 'applying'
  return 'applying'
}

function hasWindow() {
  return typeof window !== 'undefined' && !!window.addEventListener
}

function sortKeys(object, map) {
  let sorted = {}
  for (let key of Object.keys(object).sort()) {
    sorted[key] = map ? map(object[key], key) : object[key]
  }
  return sorted
}

export function createCrdtDatabase(client, db, opts = {}) {
  let dialect = opts.dialect ?? 'sqlite'
  let storageKey = opts.key ?? 'logux:db'
  let sync = opts.sync ?? true
  let emitter = createNanoEvents()
  // Without localStorage (SSR, React Native) the schema is kept in memory
  let storage =
    opts.storage ?? (typeof localStorage === 'undefined' ? {} : localStorage)
  // The flag of the interrupted migration must survive the drop of
  // the tables, so it is kept outside the database
  let migratingKey = `${storageKey}:migrating`
  let driver = db.driver
  db.pause()

  let status = atom('initializing')
  let tables = Object.create(null)
  let tableIndexes = {}
  let indexNames = new Set()
  let actions = Object.create(null)
  let actionVersions = Object.create(null)

  let prepared
  let ready = new Promise(resolve => {
    prepared = resolve
  })

  let reported = false

  function corrupted(reason, error) {
    if (reported) return
    reported = true
    if (emitter.events.corrupted?.length) {
      emitter.emit('corrupted', reason, error)
    } else if (error) {
      // The database error must not be lost, if the app has no listener
      throw error
    }
  }

  // The database, which hangs instead of throwing the error, never resolves
  // `ready`, so nothing else will detect it
  let timeout
  if (opts.timeout) {
    timeout = setTimeout(() => {
      breakDatabase(undefined, 'timeout')
    }, opts.timeout)
  }

  function setReady() {
    clearTimeout(timeout)
    prepared()
  }

  let started = false
  let hash
  let pending = []
  let pendingIds = new Set()
  let waiting = new Map()
  let inlined = new Set()
  let blocking = false
  let draining
  let sqlStore
  let destroyed = false
  let unbindStorage = () => {}
  let lockRequest = new AbortController()
  let applyLock
  let applyLockRelease
  let applyLockTimer

  function unblockClosing() {
    if (blocking && hasWindow()) {
      window.removeEventListener('beforeunload', blockClosing)
    }
    blocking = false
  }

  // Actions are already in the log, so they will be applied on the next
  // start. But the user will see the old data until the tab will be closed.
  function pushToApply(entry) {
    if (destroyed || status.value === 'outdated') return
    let id = entry[1].id
    if (pendingIds.has(id)) return
    if (!blocking && hasWindow()) {
      window.addEventListener('beforeunload', blockClosing)
      blocking = true
    }
    pendingIds.add(id)
    pending.push(entry)
  }

  function newMeta() {
    return sync ? { sync: true } : {}
  }

  /**
   * Promise for `table.create()`, `table.update()`, `table.delete()`
   * and custom actions to resolve them only after the action was applied
   * to the database, not after it was added to the log.
   */
  function applied(meta) {
    if (!meta || !pendingIds.has(meta.id)) return undefined
    return new Promise((resolve, reject) => {
      waiting.set(meta.id, [resolve, reject])
    })
  }

  function stopWaiting(ids, error) {
    for (let id of ids) {
      let callbacks = waiting.get(id)
      if (!callbacks) continue
      waiting.delete(id)
      if (error) {
        callbacks[1](error)
      } else {
        callbacks[0]()
      }
    }
  }

  function takeApplyLock() {
    applyLock ??= new Promise((taken, failed) => {
      navigator.locks
        .request(`${storageKey}:apply`, { signal: lockRequest.signal }, () => {
          // The lock is kept until `releaseApplyLock()` resolves this promise
          return new Promise(release => {
            applyLockRelease = release
            taken()
          })
        })
        .catch(error => {
          applyLock = undefined
          failed(error)
        })
    })
    return applyLock
  }

  function releaseApplyLock() {
    clearTimeout(applyLockTimer)
    applyLockTimer = undefined
    // The request, which was not granted yet, will be released after
    // the write or aborted by `lockRequest`. Forgetting it here will take
    // the second lock with the same name and will block the tab forever.
    if (applyLockRelease) {
      applyLock = undefined
      applyLockRelease()
      applyLockRelease = undefined
    }
  }

  function releaseApplyLockLater() {
    clearTimeout(applyLockTimer)
    applyLockTimer = setTimeout(releaseApplyLock, APPLY_LOCK_IDLE)
  }

  // Taking the Web Lock costs a round trip to the browser process, and
  // the app writes to the tables action by action, so the lock is taken
  // once for the whole burst and is released a little after the last write
  function withApplyLock(callback) {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      clearTimeout(applyLockTimer)
      applyLockTimer = undefined
      return takeApplyLock().then(callback).finally(releaseApplyLockLater)
    } else {
      return callback()
    }
  }

  // The lock is taken outside of the queue: a database waiting for its turn
  // must not block another database, which is not waiting for the lock
  function writeToTables(callback) {
    return withApplyLock(() => inTransaction(callback))
  }

  function inTransaction(callback) {
    let store = client.log.store
    // The log store has its own queue for the same connection,
    // so its writes must go through it, not around it
    if (store.write && store.driver === driver) return store.write(callback)
    let previous = WRITES.get(driver) ?? Promise.resolve()
    let result = previous.then(() => db.transaction(callback))
    WRITES.set(
      driver,
      result.catch(() => {})
    )
    return result
  }

  function drain() {
    if (!draining) {
      draining = applyPending().finally(() => {
        draining = undefined
        if (pending.length === 0) unblockClosing()
      })
    }
    return draining
  }

  async function applyPending() {
    while (pending.length > 0) {
      if (destroyed || status.value === 'outdated') break
      let chunk = pending.splice(0, CHUNK_SIZE)
      let ids = chunk.map(entry => entry[1].id)
      try {
        await writeToTables(async tx => {
          for (let entry of chunk) {
            await applyAndEmit(tx, entry[0], entry[1])
          }
        })
      } catch (e) {
        // Actions still have the reason, so this or another tab
        // will apply them on the next start
        pending.unshift(...chunk)
        stopWaiting(ids, e)
        break
      }
      for (let id of ids) pendingIds.delete(id)
      stopWaiting(ids)
      // Reasons are removed by a single call after the commit: applying
      // the action twice is safe, but losing it will keep the database
      // incomplete forever. Actions, which were never written to the log,
      // have no reason to remove.
      // Metas of restored actions from repeat() have no reasons at all
      if (chunk.some(entry => entry[1].reasons?.includes('applying-to-db'))) {
        await client.log.removeReason('applying-to-db', { ids })
      }
    }
  }

  function checkDefine() {
    if (started) {
      throw new Error('Defined tables sync')
    }
  }

  function isKnown(type) {
    return !!actions[type] || !!parseCrdtType(type, crdt)
  }

  async function applyAction(action, meta, tx) {
    let custom = actions[action.type]
    if (custom) {
      await custom(tx, action, meta)
      return
    }

    let parsed = parseCrdtType(action.type, crdt)
    if (!parsed) return
    let { plural, verb } = parsed
    // Sortable meta can be compared by SQL and by JS strings
    let sorted = toSorted(meta)
    let schema = tables[plural]
    let target = tx.driver

    if (verb === 'deleted') {
      let ids = action.ids ?? [action.id]
      if (ids.length === 0) return [[], []]
      await target.exec(
        `DELETE FROM "${plural}" WHERE "id" IN (${holders(ids.length)})`,
        ids
      )
      return [[], []]
    }

    let records = parseCrdtRows(action)
    if (records.length === 0) return [[], []]

    // Cells addressed by the action: the cells it lost are `touched`
    // without `won`
    let touched = []
    let columns = new Set()
    for (let [id, fields] of records) {
      for (let key in fields) {
        if (schema[key] && fields[key] !== undefined) {
          touched.push([plural, id, key])
          columns.add(key)
        }
      }
    }
    if (columns.size === 0) return [[], []]

    // Only meta of the fields from the action is necessary to resolve conflicts
    let metaColumns = ['"id"']
    for (let key of columns) metaColumns.push(`"${META}${key}"`)
    let rows = await target.select(
      `SELECT ${metaColumns.join(', ')} FROM "${plural}"` +
        ` WHERE "id" IN (${holders(records.length)})`,
      records.map(record => record[0])
    )
    let known = new Map()
    for (let row of rows) known.set(row.id, row)

    let won = []
    let inserts = []
    let updates = new Map()
    for (let [id, fields] of records) {
      let row = known.get(id)
      let insert = row === undefined
      if (insert) {
        if (verb === 'changed') continue
        row = {}
        known.set(id, row)
      }
      let keys = []
      let values = []
      for (let key in fields) {
        let last = row[`${META}${key}`]
        if (
          schema[key] &&
          fields[key] !== undefined &&
          (!last || last < sorted)
        ) {
          keys.push(key)
          values.push(fields[key])
          // Keep meta for the next record with the same ID in this batch
          row[`${META}${key}`] = sorted
        }
      }
      if (keys.length === 0) continue
      for (let key of keys) won.push([plural, id, key])
      if (insert) {
        // The row is built by the column list of the whole action below
        let record = Object.create(null)
        for (let i = 0; i < keys.length; i++) record[keys[i]] = values[i]
        inserts.push([id, record])
      } else {
        // Rows with the same changes are updated by a single query,
        // since all of them get the same action’s meta ID
        let groupKey = JSON.stringify([keys, values])
        let group = updates.get(groupKey)
        if (!group) {
          group = { ids: [], keys, values }
          updates.set(groupKey, group)
        }
        group.ids.push(id)
      }
    }

    let queries = []
    if (inserts.length > 0) {
      // All fields of the action are used as columns and fields missing
      // in the record are inserted as NULL, so records with different
      // fields still fit into a single query
      let all = [...columns]
      let names = ['"id"']
      for (let key of all) names.push(`"${key}"`)
      for (let key of all) names.push(`"${META}${key}"`)
      let row = `(${holders(names.length)})`
      let params = []
      for (let [id, record] of inserts) {
        params.push(id)
        for (let key of all) params.push(key in record ? record[key] : null)
        for (let key of all) params.push(key in record ? sorted : null)
      }
      queries.push([
        `INSERT INTO "${plural}" (${names.join(', ')})` +
          ` VALUES ${Array(inserts.length).fill(row).join(', ')}`,
        params
      ])
    }
    for (let group of updates.values()) {
      let sets = []
      for (let key of group.keys) sets.push(`"${key}" = ?`)
      for (let key of group.keys) sets.push(`"${META}${key}" = ?`)
      queries.push([
        `UPDATE "${plural}" SET ${sets.join(', ')}` +
          ` WHERE "id" IN (${holders(group.ids.length)})`,
        [...group.values, ...group.keys.map(() => sorted), ...group.ids]
      ])
    }

    await execAll(target, queries)
    return [won, touched]
  }

  async function applyAndEmit(tx, action, meta) {
    let cells = await applyAction(action, meta, tx)
    if (!cells) return
    // Listeners write to the applying transaction, so they can not be parallel
    let listeners = emitter.events.applied
    if (listeners) {
      for (let listener of listeners) {
        await listener(tx, action, meta, cells[0], cells[1])
      }
    }
  }

  async function applyInline(tx, action, meta) {
    if (destroyed || status.value === 'outdated') return
    // Actions with the reason are applied by batches, which remove
    // the reasons of the whole batch by a single call
    if (meta.reasons.includes('applying-to-db')) return
    if (!isKnown(action.type)) return
    await applyAndEmit(tx, action, meta)
    inlined.add(meta.id)
  }

  function becomeReady() {
    let store = client.log.store
    // Actions of this tab will be applied in the same transaction,
    // which writes them to the log, so `await table.update()` will mean
    // that the row was already changed
    if (!destroyed && store.onTransactionAdd && store.driver === driver) {
      sqlStore = store
      sqlStore.onTransactionAdd(applyInline)
    }
    status.set('ready')
    db.resume()
    setReady()
    if (pending.length > 0) void drain()
  }

  async function createIndexes(target, plural) {
    for (let sql of tableIndexes[plural]) {
      await target.exec(sql, [])
    }
  }

  /**
   * Another tab with a newer bundle has already migrated the database,
   * so this tab must not touch it and must be reloaded.
   */
  function becomeOutdated() {
    if (status.value === 'outdated') return
    status.set('outdated')
    db.pause()
    emitter.emit('stop')
    setReady()
    stopWaiting([...waiting.keys()], new Error('The database is outdated'))
    pending = []
    pendingIds.clear()
    lockRequest.abort()
    unblockClosing()
  }

  function breakDatabase(error, reason = 'error') {
    if (destroyed) return
    if (error && error.name === 'LoguxNewerDatabase') {
      becomeOutdated()
      return
    }
    status.set('broken')
    stopApplying('The database is broken')
    lockRequest.abort()
    setReady()
    corrupted(reason, error)
  }

  let preparing = Promise.resolve().then(async () => {
    started = true
    hash = JSON.stringify({
      actions: sortKeys(actionVersions),
      tables: sortKeys(tables, (schema, plural) => ({
        columns: sortKeys(schema, col => ({
          sql:
            col.sql && typeof col.sql === 'object'
              ? sortKeys(col.sql)
              : col.sql,
          type: col.type,
          values: col.values
        })),
        indexes: tableIndexes[plural]
      })),
      version: LOGUX_CRDT_TABLE_VERSION
    })

    // Only localStorage sends `storage` events to sync other tabs
    if (hasWindow() && storage === window.localStorage && !destroyed) {
      let onOutdated = event => {
        if (event.key !== storageKey || event.newValue === null) return
        if (event.newValue !== hash) becomeOutdated()
      }
      window.addEventListener('storage', onOutdated)
      unbindStorage = () => {
        window.removeEventListener('storage', onOutdated)
      }
    }

    // Actions are in the memory between the drop of the tables and the end
    // of the replay, so the tab, which was closed in the middle, lost them
    if (storage[migratingKey]) {
      delete storage[migratingKey]
      corrupted('interrupted-migration')
    }

    // The schema hash in the storage says nothing about the file, which
    // the driver opened, so the database keeps its own copy of it
    let old = storage[storageKey]
    let stored
    await inTransaction(async tx => {
      await tx.driver.exec(
        `CREATE TABLE IF NOT EXISTS "${SERVICE}"` +
          ` ("key" TEXT PRIMARY KEY, "value" TEXT)`,
        []
      )
      let version = await readService(tx.driver, 'version')
      if (version && Number(version) > LOGUX_CRDT_TABLE_VERSION) {
        throw newerDatabaseError('Tables')
      }
      stored = await readService(tx.driver, 'schema')
    })

    if (!stored && old) {
      // Database file was lost but we have the marker in localStorage
      corrupted('lost-database')
    }

    if (stored === hash) {
      // The database survived the cleaned storage, so only the copy
      // of the hash has to be restored
      if (old !== hash) storage[storageKey] = hash
      // Every statement pays for the write on its own, so the whole schema
      // is created in a single transaction
      await inTransaction(async tx => {
        for (let plural in tables) {
          await tx.driver.exec(
            createTableSql(plural, tables[plural], dialect),
            []
          )
          await createIndexes(tx.driver, plural)
        }
      })
      // Actions, which were not applied before the last tab was closed
      let unapplied = []
      await client.log.each({ order: 'added' }, (action, meta) => {
        if (meta.reasons.includes('applying-to-db')) {
          unapplied.push([action, meta])
        }
      })
      // The log is read from the newest action to the oldest
      unapplied.reverse()
      unapplied.forEach(pushToApply)
      await drain()
      becomeReady()
    } else {
      // The log and the tables are only read here, so the log entries
      // are collected in parallel with the repeat() callback
      let entries = []
      let reading = client.log.each({ order: 'added' }, (action, meta) => {
        if (isKnown(action.type)) entries.push([action, meta])
      })
      let repeated = []
      if (stored) {
        status.set('migrating')
        emitter.emit('migrating', ready)
        // Tables are dropped after the callback, so actions missing
        // from the log can be restored from the tables themselves
        if (opts.repeat) repeated = await opts.repeat()
      }
      await reading
      // The log is read from the newest action to the oldest
      entries.reverse()
      if (stored) storage[migratingKey] = '1'
      // Tables, which were removed from the schema, are dropped too.
      // A single transaction both saves the write for every statement
      // and keeps the old tables on an error
      await inTransaction(async tx => {
        if (stored) {
          for (let oldTable in JSON.parse(stored).tables) {
            await tx.driver.exec(`DROP TABLE IF EXISTS "${oldTable}"`, [])
          }
        }
        for (let plural in tables) {
          await tx.driver.exec(`DROP TABLE IF EXISTS "${plural}"`, [])
          await tx.driver.exec(
            createTableSql(plural, tables[plural], dialect),
            []
          )
        }
      })
      let added = pending
      pending = []
      pendingIds.clear()
      // The lists are not merged: a copy of the whole log costs the memory
      for (let list of [entries, repeated, added]) list.forEach(pushToApply)
      await drain()
      // Indexes are created after the replay: filling the table
      // without them is much faster. The hash is written by the same
      // transaction, so an error keeps the database unfinished
      await inTransaction(async tx => {
        for (let plural in tables) {
          await createIndexes(tx.driver, plural)
        }
        await writeService(tx.driver, 'schema', hash)
        await writeService(tx.driver, 'version', `${LOGUX_CRDT_TABLE_VERSION}`)
      })
      storage[storageKey] = hash
      delete storage[migratingKey]
      becomeReady()
    }
  })
  void preparing.catch(breakDatabase)

  // Reason keeps the action in the log until it will be applied,
  // so any tab can find and finish the work of the crashed tab
  let unbindPreadd = client.on('preadd', (action, meta) => {
    if (!isKnown(action.type)) return
    // Actions with another reason are applied in the same transaction,
    // which writes them to the log. Actions without any reason are not
    // written to the log at all and are applied by batches.
    if (sqlStore && status.value === 'ready') return
    meta.reasons.push('applying-to-db')
  })

  let unbindAdd = client.on('add', (action, meta) => {
    // Actions were already applied in the log store transaction
    if (inlined.delete(meta.id)) return
    if (!isKnown(action.type)) return
    pushToApply([action, meta])
    if (status.value === 'ready') void drain()
  })

  let unbindCleaning = client.on('cleaning', cleanTables)

  async function cleanTables() {
    let outdated = status.value === 'outdated'
    let isBroken = status.value === 'broken'
    stopApplying('The database was cleaned')
    await ready
    // The chunk, which is applied right now, would fill the tables again
    if (draining) await draining.catch(() => {})
    if (!outdated) {
      delete storage[storageKey]
      if (!isBroken) {
        db.pause()
        await writeToTables(async tx => {
          for (let plural in tables) {
            await tx.driver.exec(`DROP TABLE IF EXISTS "${plural}"`, [])
          }
          await tx.driver.exec(`DROP TABLE IF EXISTS "${SERVICE}"`, [])
        })
      }
    }
    lockRequest.abort()
  }

  // Unsubscribe from the log to be sure that nothing will be applied
  // to the tables anymore
  function stopApplying(reason) {
    if (destroyed) return
    destroyed = true
    releaseApplyLock()
    unbindPreadd()
    unbindAdd()
    unbindStorage()
    unbindCleaning()
    if (sqlStore && sqlStore.onAdd === applyInline) {
      sqlStore.onTransactionAdd(undefined)
    }
    stopWaiting([...waiting.keys()], new Error(reason))
    pending = []
    pendingIds.clear()
    unblockClosing()
  }

  let crdt = {
    action(creator, apply, actionOpts = {}) {
      checkDefine()
      actions[creator.type] = apply
      actionVersions[creator.type] = actionOpts.version ?? null
      return async (...args) => {
        await applied(await client.log.add(creator(...args), newMeta()))
      }
    },
    clean: cleanTables,
    destroy() {
      stopApplying('The database was stopped')
      lockRequest.abort()
    },
    async empty() {
      await ready
      // Empty pending list before cleaning tables
      await drain()
      await writeToTables(async tx => {
        for (let plural in tables) {
          await tx.driver.exec(`DELETE FROM "${plural}"`, [])
        }
      })
    },
    on(event, listener) {
      return emitter.on(event, listener)
    },
    ready,
    status,
    table(plural, schema, indexes = []) {
      checkDefine()
      for (let name in schema) {
        if (schema[name].type === 'BOOLEAN' && dialect === 'sqlite') {
          throw new Error('sqlite does not support boolean')
        }
        if (name.startsWith(META)) {
          throw new Error(`${META} prefix is reserved for fields meta`)
        }
      }
      tableIndexes[plural] = indexes
        .map(index => indexSql(plural, schema, index, indexNames))
        .sort((a, b) => (a < b ? -1 : 1))
      tables[plural] = schema

      function withDefaults(fields) {
        let { id = nanoid(), ...values } = fields
        for (let key in schema) {
          // `null` means the same as a missing field, so rows from select(),
          // where missing values are SQL NULL, can be passed back to create()
          if (values[key] === null) delete values[key]
          if (values[key] === undefined && 'default' in schema[key]) {
            let byDefault = schema[key].default
            values[key] =
              typeof byDefault === 'function' ? byDefault() : byDefault
          }
        }
        return [id, values]
      }

      return {
        async change(tx, id, fields, meta) {
          let cells = await applyAction(
            Array.isArray(id)
              ? { fields, ids: id, type: `${plural}/changed` }
              : { fields, id, type: `${plural}/changed` },
            meta,
            tx
          )
          return cells[0]
        },
        async create(fields) {
          let action
          let created
          if (Array.isArray(fields)) {
            if (fields.length === 0) return []
            created = []
            let records = fields.map(i => {
              let [id, values] = withDefaults(i)
              created.push(id)
              return { id, ...values }
            })
            action = { records, type: `${plural}/created` }
          } else {
            let [id, values] = withDefaults(fields)
            created = id
            action = { fields: values, id, type: `${plural}/created` }
          }
          await applied(await client.log.add(action, newMeta()))
          return created
        },
        async delete(id) {
          let batch = Array.isArray(id)
          if (batch && id.length === 0) return
          await applied(
            await client.log.add(
              batch
                ? { ids: id, type: `${plural}/deleted` }
                : { id, type: `${plural}/deleted` },
              newMeta()
            )
          )
        },
        driver,
        plural,
        schema,
        select(template, ...params) {
          let prefix = `SELECT "${plural}".* FROM "${plural}"`
          let parts = template
            ? [`${prefix} ${template[0]}`, ...template.slice(1)]
            : [prefix]
          return db.store(parts, ...params)
        },
        async update(id, diff) {
          let batch = Array.isArray(id)
          if (batch && id.length === 0) return
          await applied(
            await client.log.add(
              batch
                ? { fields: diff, ids: id, type: `${plural}/changed` }
                : { fields: diff, id, type: `${plural}/changed` },
              newMeta()
            )
          )
        }
      }
    },
    tables
  }

  return crdt
}

export function createCrdtTasks(crdt, opts = {}) {
  let onError = opts.onError ?? (error => console.error(error))

  let destroyed = false
  let start
  let queue = new Promise(resolve => {
    start = resolve
  })
  void crdt.ready.then(() => {
    start()
  })

  return {
    add(task) {
      queue = queue.then(async () => {
        if (destroyed) return
        try {
          await task()
        } catch (error) {
          if (!destroyed) onError(error)
        }
      })
    },
    destroy() {
      destroyed = true
      start()
    },
    finish() {
      return queue
    }
  }
}
