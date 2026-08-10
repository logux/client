import { toSorted } from '@logux/core'
import { nanoid } from 'nanoid'
import { atom } from 'nanostores'

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

/**
 * How many actions to apply in a single transaction.
 */
const CHUNK_SIZE = 1000

const VERBS = {
  changed: 1,
  created: 2,
  deleted: 3
}

const RESULT = ['', 0]

function holders(count) {
  return Array(count).fill('?').join(', ')
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
    sorted[key] = map ? map(object[key]) : object[key]
  }
  return sorted
}

export function createCrdtDatabase(client, db, opts = {}) {
  let dialect = opts.dialect ?? 'sqlite'
  let storageKey = opts.key ?? 'logux:db'
  let stop = opts.stop ?? (() => {})
  let driver = db.driver
  db.pause()

  let status = atom('initializing')
  let tables = {}
  let actions = Object.create(null)
  let actionVersions = Object.create(null)

  let setReady
  let ready = new Promise(resolve => {
    setReady = resolve
  })

  let started = false
  let hash
  let pending = []
  let pendingIds = new Set()
  let waiting = new Map()
  let inlined = new Set()
  let removing = new Set()
  let blocking = false
  let draining
  let sqlStore
  let destroyed = false
  let unbindStorage = () => {}
  let lockRequest = new AbortController()

  function unblockClosing() {
    if (blocking && hasWindow()) {
      window.removeEventListener('beforeunload', blockClosing)
    }
    blocking = false
  }

  // Actions are already in the log, so they will be applied on the next
  // start. But the user will see the old data until the tab will be closed.
  function pushToApply(action, meta) {
    if (destroyed || status.value === 'outdated') return
    if (pendingIds.has(meta.id)) return
    if (!blocking && hasWindow()) {
      window.addEventListener('beforeunload', blockClosing)
      blocking = true
    }
    pendingIds.add(meta.id)
    pending.push([action, meta])
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

  function withApplyLock(callback) {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(
        `${storageKey}:apply`,
        { signal: lockRequest.signal },
        callback
      )
    } else {
      return callback()
    }
  }

  function writeToTables(callback) {
    return withApplyLock(() => {
      // Log store’s transaction to not open two transactions
      // in the same database connection
      return sqlStore ? sqlStore.write(callback) : db.transaction(callback)
    })
  }

  // Returns the promise of the work, which is already in progress, so
  // clean() could wait for the chunk, which is applied right now
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
            await applyAction(entry[0], entry[1], tx)
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
      // incomplete forever
      await client.log.removeReason('applying-to-db', { ids })
    }
  }

  function checkDefine() {
    if (started) {
      throw new Error(
        'All tables and actions must be defined sync' +
          ' after createCrdtDatabase()'
      )
    }
  }

  function parseType(type) {
    let slash = type.lastIndexOf('/')
    if (slash === -1) return undefined
    let plural = type.slice(0, slash)
    if (!tables[plural]) return undefined
    let verb = VERBS[type.slice(slash + 1)]
    if (!verb) return undefined
    RESULT[0] = plural
    RESULT[1] = verb
    return RESULT
  }

  function isKnown(type) {
    return !!actions[type] || !!parseType(type)
  }

  async function applyAction(action, meta, tx) {
    let custom = actions[action.type]
    if (custom) {
      await custom(tx, action, meta)
      return
    }

    let parsed = parseType(action.type)
    if (!parsed) return
    let [plural, verb] = parsed
    // Sortable meta can be compared by SQL and by JS strings
    let sorted = toSorted(meta)
    let schema = tables[plural]
    let target = tx.driver

    if (verb === VERBS.deleted) {
      let ids = action.ids ?? [action.id]
      if (ids.length === 0) return
      await target.exec(
        `DELETE FROM "${plural}" WHERE "id" IN (${holders(ids.length)})`,
        ids
      )
      return
    }

    let records
    if (action.records) {
      records = action.records.map(fields => [fields.id, fields])
    } else if (action.ids) {
      records = action.ids.map(id => [id, action.fields])
    } else {
      records = [[action.id, action.fields]]
    }
    if (records.length === 0) return

    let touched = new Set()
    for (let record of records) {
      for (let key in record[1]) {
        if (schema[key]) touched.add(key)
      }
    }
    if (touched.size === 0) return

    // Only meta of the fields from the action is necessary to resolve conflicts
    let columns = ['"id"']
    for (let key of touched) columns.push(`"${META}${key}"`)
    let rows = await target.select(
      `SELECT ${columns.join(', ')} FROM "${plural}"` +
        ` WHERE "id" IN (${holders(records.length)})`,
      records.map(record => record[0])
    )
    let known = new Map()
    for (let row of rows) known.set(row.id, row)

    let inserts = []
    let updates = new Map()
    for (let [id, fields] of records) {
      let row = known.get(id)
      let insert = row === undefined
      if (insert) {
        if (verb === VERBS.changed) continue
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
      if (insert) {
        inserts.push([id, keys, values])
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
      let all = [...touched]
      let names = ['"id"']
      for (let key of all) names.push(`"${key}"`)
      for (let key of all) names.push(`"${META}${key}"`)
      let row = `(${holders(names.length)})`
      let params = []
      for (let [id, keys, values] of inserts) {
        let indexes = all.map(key => keys.indexOf(key))
        params.push(id)
        for (let i of indexes) params.push(i === -1 ? null : values[i])
        for (let i of indexes) params.push(i === -1 ? null : sorted)
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
  }

  // Actions, applied inside the log store transaction, still have
  // the reason. Removing them by batches saves a store transaction
  // on every action.
  function removeApplied(id) {
    removing.add(id)
    if (removing.size > 1) return
    // Timeout instead of microtask: it collects the whole burst
    // of writes into a single log transaction
    setTimeout(() => {
      let ids = [...removing]
      removing.clear()
      client.log.removeReason('applying-to-db', { ids }).catch(() => {
        // The actions will be applied again on the next start
      })
    })
  }

  async function applyInline(tx, action, meta) {
    if (destroyed || status.value === 'outdated') return
    if (!isKnown(action.type)) return
    await applyAction(action, meta, tx)
    inlined.add(meta.id)
  }

  function becomeReady() {
    let store = client.log.store
    // Actions of this tab will be applied in the same transaction,
    // which writes them to the log, so `await table.update()` will mean
    // that the row was already changed
    if (!destroyed && store.onTransactionAdd && store.driver === db.driver) {
      sqlStore = store
      sqlStore.onTransactionAdd(applyInline)
    }
    status.set('ready')
    db.resume()
    setReady()
  }

  void Promise.resolve().then(async () => {
    started = true
    hash = JSON.stringify({
      actions: sortKeys(actionVersions),
      tables: sortKeys(tables, schema =>
        sortKeys(schema, col => ({
          sql:
            col.sql && typeof col.sql === 'object'
              ? sortKeys(col.sql)
              : col.sql,
          type: col.type,
          values: col.values
        }))
      ),
      version: LOGUX_CRDT_TABLE_VERSION
    })

    if (typeof window !== 'undefined' && !destroyed) {
      let onOutdated = event => {
        if (event.key !== storageKey || event.newValue === null) return
        if (event.newValue !== hash) {
          if (status.get() === 'outdated') return
          status.set('outdated')
          db.pause()
          stop()
          setReady()
          stopWaiting(
            [...waiting.keys()],
            new Error(
              'The database was stopped before the action was applied to it'
            )
          )
          pending = []
          pendingIds.clear()
          lockRequest.abort()
          unblockClosing()
        }
      }
      window.addEventListener('storage', onOutdated)
      unbindStorage = () => {
        window.removeEventListener('storage', onOutdated)
      }
    }

    let old =
      typeof localStorage === 'undefined'
        ? null
        : localStorage.getItem(storageKey)
    if (old === hash) {
      for (let plural in tables) {
        await driver.exec(createTableSql(plural, tables[plural], dialect), [])
      }
      // Actions, which were not applied before the last tab was closed
      let unapplied = []
      await client.log.each({ order: 'added' }, (action, meta) => {
        if (meta.reasons.includes('applying-to-db')) {
          unapplied.unshift([action, meta])
        }
      })
      for (let entry of unapplied) pushToApply(entry[0], entry[1])
      await drain()
      becomeReady()
    } else {
      if (old !== null) {
        status.set('migrating')
        if (opts.migrating) opts.migrating(ready)
        for (let oldTable in JSON.parse(old).tables) {
          await driver.exec(`DROP TABLE IF EXISTS "${oldTable}"`, [])
        }
      }
      for (let plural in tables) {
        await driver.exec(`DROP TABLE IF EXISTS "${plural}"`, [])
        await driver.exec(createTableSql(plural, tables[plural], dialect), [])
      }
      let entries = []
      await client.log.each({ order: 'added' }, (action, meta) => {
        if (isKnown(action.type)) entries.unshift([action, meta])
      })
      if (old !== null && opts.repeat) {
        entries = entries.concat(await opts.repeat())
      }
      let added = pending
      pending = []
      pendingIds.clear()
      for (let entry of entries.concat(added)) pushToApply(entry[0], entry[1])
      await drain()
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, hash)
      }
      becomeReady()
    }
  })

  // Reason keeps the action in the log until it will be applied,
  // so any tab can find and finish the work of the crashed tab
  let unbindPreadd = client.on('preadd', (action, meta) => {
    if (isKnown(action.type)) meta.reasons.push('applying-to-db')
  })

  let unbindAdd = client.on('add', (action, meta) => {
    if (!meta.reasons.includes('applying-to-db')) return
    if (inlined.has(meta.id)) {
      inlined.delete(meta.id)
      removeApplied(meta.id)
      return
    }
    pushToApply(action, meta)
    if (status.value === 'ready') void drain()
  })

  let unbindCleaning = client.on('cleaning', cleanTables)

  async function cleanTables() {
    let outdated = status.value === 'outdated'
    stopApplying('The database was cleaned')
    await ready
    // The chunk, which is applied right now, would fill the tables again
    if (draining) await draining.catch(() => {})
    if (!outdated) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey)
      }
      db.pause()
      await writeToTables(async tx => {
        for (let plural in tables) {
          await tx.driver.exec(`DROP TABLE IF EXISTS "${plural}"`, [])
        }
      })
    }
    lockRequest.abort()
  }

  // Unsubscribe from the log to be sure that nothing will be applied
  // to the tables anymore
  function stopApplying(reason) {
    if (destroyed) return
    destroyed = true
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

  return {
    action(creator, apply, actionOpts = {}) {
      checkDefine()
      actions[creator.type] = apply
      actionVersions[creator.type] = actionOpts.version ?? null
      return async (...args) => {
        await applied(await client.log.add(creator(...args), { sync: true }))
      }
    },
    clean: cleanTables,
    destroy() {
      stopApplying('The database was stopped')
      lockRequest.abort()
    },
    ready,
    status,
    table(plural, schema) {
      checkDefine()
      for (let name in schema) {
        if (schema[name].type === 'BOOLEAN' && dialect === 'sqlite') {
          throw new Error('sqlite does not support boolean')
        }
        if (name.startsWith(META)) {
          throw new Error(`${META} prefix is reserved for fields meta`)
        }
      }
      tables[plural] = schema

      function withDefaults(fields) {
        let { id = nanoid(), ...values } = fields
        for (let key in schema) {
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
          await applyAction(
            Array.isArray(id)
              ? { fields, ids: id, type: `${plural}/changed` }
              : { fields, id, type: `${plural}/changed` },
            meta,
            tx
          )
        },
        async create(fields) {
          if (Array.isArray(fields)) {
            if (fields.length === 0) return []
            let ids = []
            let records = fields.map(i => {
              let [id, values] = withDefaults(i)
              ids.push(id)
              return { id, ...values }
            })
            let meta = await client.log.add(
              { records, type: `${plural}/created` },
              { sync: true }
            )
            await applied(meta)
            return ids
          } else {
            let [id, values] = withDefaults(fields)
            let meta = await client.log.add(
              { fields: values, id, type: `${plural}/created` },
              { sync: true }
            )
            await applied(meta)
            return id
          }
        },
        async delete(id) {
          if (Array.isArray(id)) {
            if (id.length === 0) return
            await applied(
              await client.log.add(
                { ids: id, type: `${plural}/deleted` },
                { sync: true }
              )
            )
          } else {
            await applied(
              await client.log.add(
                { id, type: `${plural}/deleted` },
                { sync: true }
              )
            )
          }
        },
        plural,
        select(template, ...params) {
          let prefix = `SELECT "${plural}".* FROM "${plural}"`
          let parts = template
            ? [`${prefix} ${template[0]}`, ...template.slice(1)]
            : [prefix]
          return db.store(parts, ...params)
        },
        async update(id, diff) {
          if (Array.isArray(id)) {
            if (id.length === 0) return
            await applied(
              await client.log.add(
                { fields: diff, ids: id, type: `${plural}/changed` },
                { sync: true }
              )
            )
          } else {
            await applied(
              await client.log.add(
                { fields: diff, id, type: `${plural}/changed` },
                { sync: true }
              )
            )
          }
        }
      }
    }
  }
}
