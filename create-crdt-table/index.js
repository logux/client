import { isFirstOlder } from '@logux/core'
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
 * Prefix of columns with Logux Meta ID of the last change of every field
 * for CRDT LWW.
 */
const META = 'updatedAt_'

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

  let setReady
  let ready = new Promise(resolve => {
    setReady = resolve
  })

  let started = false
  let hash
  let actionsWaiting = []
  let isLeader = false
  let releaseLock = () => {}
  let queue = Promise.resolve()
  let destroyed = false
  let unbindStorage = () => {}
  let lockRequest = new AbortController()

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

  async function applyAction(action, meta, tx) {
    let parsed = parseType(action.type)
    if (!parsed) return
    let [plural, verb] = parsed
    let schema = tables[plural]
    let target = tx ?? driver

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
        if (
          schema[key] &&
          fields[key] !== undefined &&
          isFirstOlder(row[`${META}${key}`], meta)
        ) {
          keys.push(key)
          values.push(fields[key])
          // Keep meta for the next record with the same ID in this batch
          row[`${META}${key}`] = meta.id
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
        for (let i of indexes) params.push(i === -1 ? null : meta.id)
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
        [...group.values, ...group.keys.map(() => meta.id), ...group.ids]
      ])
    }

    if (tx || queries.length < 2) {
      await execAll(target, queries)
    } else {
      await driver.transaction(newTx => execAll(newTx, queries))
    }
  }

  function becomeReady() {
    for (let entry of actionsWaiting) {
      queue = queue.then(() => applyAction(entry[0], entry[1]))
    }
    actionsWaiting = []
    status.set('ready')
    db.resume()
    setReady()
  }

  void Promise.resolve().then(async () => {
    started = true
    hash = JSON.stringify({
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
          releaseLock()
          setReady()
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
      await client.log.each((action, meta) => {
        if (parseType(action.type)) entries.unshift([action, meta])
      })
      if (old !== null && opts.repeat) {
        entries = entries.concat(await opts.repeat())
      }
      if (entries.length > 0) {
        await driver.transaction(async tx => {
          for (let entry of entries) {
            await applyAction(entry[0], entry[1], tx)
          }
        })
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, hash)
      }
      becomeReady()
    }
  })

  if (typeof navigator !== 'undefined' && navigator.locks) {
    navigator.locks
      .request(`${storageKey}:lock`, { signal: lockRequest.signal }, () => {
        if (status.get() === 'outdated' || destroyed) return Promise.resolve()
        isLeader = true
        return new Promise(resolve => {
          releaseLock = resolve
        })
      })
      .catch(() => {
        // Lock request was aborted by destroy()
      })
  } else {
    isLeader = true
  }

  let unbindAdd = client.on('add', (action, meta) => {
    if (!isLeader || status.value === 'outdated') return
    if (!parseType(action.type)) return
    if (status.value !== 'ready') {
      actionsWaiting.push([action, meta])
    } else {
      queue = queue.then(() => applyAction(action, meta))
    }
  })

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      isLeader = false
      unbindAdd()
      unbindStorage()
      lockRequest.abort()
      releaseLock()
    },
    ready,
    status,
    table(plural, schema) {
      if (started) {
        throw new Error(
          'All tables must be defined sync after createCrdtDatabase()'
        )
      }
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
        async create(fields) {
          if (Array.isArray(fields)) {
            let ids = []
            let records = fields.map(i => {
              let [id, values] = withDefaults(i)
              ids.push(id)
              return { id, ...values }
            })
            await client.log.add(
              { records, type: `${plural}/created` },
              { sync: true }
            )
            return ids
          }
          let [id, values] = withDefaults(fields)
          await client.log.add(
            { fields: values, id, type: `${plural}/created` },
            { sync: true }
          )
          return id
        },
        async delete(id) {
          await client.log.add(
            Array.isArray(id)
              ? { ids: id, type: `${plural}/deleted` }
              : { id, type: `${plural}/deleted` },
            { sync: true }
          )
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
          await client.log.add(
            Array.isArray(id)
              ? { fields: diff, ids: id, type: `${plural}/changed` }
              : { fields: diff, id, type: `${plural}/changed` },
            { sync: true }
          )
        }
      }
    }
  }
}
