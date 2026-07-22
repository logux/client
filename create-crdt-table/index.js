import { isFirstOlder } from '@logux/core'
import stringify from 'fast-json-stable-stringify'
import { nanoid } from 'nanoid'
import { atom } from 'nanostores'

const VERBS = new Set([
  'change',
  'changed',
  'create',
  'created',
  'delete',
  'deleted'
])

const SQL_TYPES = {
  boolean: 'INTEGER',
  date: 'BIGINT',
  number: 'DOUBLE PRECISION',
  string: 'TEXT'
}

function column(type, opts = {}) {
  if (typeof opts === 'string') opts = { sql: opts }
  return { required: !('default' in opts), type, ...opts }
}

export function string(opts) {
  return column('string', opts)
}

export function number(opts) {
  return column('number', opts)
}

export function boolean(opts) {
  return column('boolean', opts)
}

export function date(opts) {
  return column('date', opts)
}

export function oneOf(values, opts) {
  return { ...column('string', opts), values }
}

export function optional(col) {
  return { ...col, nullable: true, required: false }
}

function encodeValue(col, value) {
  if (value === null || value === undefined) return null
  if (col.type === 'boolean') return value ? 1 : 0
  if (col.type === 'date') {
    return value instanceof Date ? value.getTime() : Number(value)
  }
  return value
}

function serializeFields(fields) {
  let serialized = {}
  for (let key in fields) {
    let value = fields[key]
    if (value instanceof Date) value = value.getTime()
    serialized[key] = value ?? null
  }
  return serialized
}

function encodeParam(value) {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.getTime()
  return value
}

function columnSql(name, col, dialect) {
  let sql = `"${name}" ${SQL_TYPES[col.type]}`
  if (col.values) {
    let values = col.values.map(i => `'${i.replaceAll("'", "''")}'`)
    sql += ` CHECK ("${name}" IN (${values.join(', ')}))`
  }
  let extra = col.sql
  if (extra && typeof extra === 'object') extra = extra[dialect]
  if (extra) sql += ` ${extra}`
  return sql
}

function queryRows(driver, sql, params) {
  return new Promise(resolve => {
    let unsubscribe = driver.subscribe(sql, params, rows => {
      resolve(rows)
      void Promise.resolve().then(() => unsubscribe())
    })
  })
}

export function createCrdtDatabase(client, db, callbacks = {}) {
  let dialect = callbacks.dialect ?? 'sqlite'
  let storageKey = callbacks.key ?? 'logux:db'
  let stop = callbacks.stop ?? (() => {})
  let driver = db.driver
  db.pause()

  let status = atom('initializing')
  let tables = {}

  let started = false
  let hash
  let actionsWaiting = []
  let isLeader = false
  let releaseLock = () => {}
  let queue = Promise.resolve()

  function parseType(type) {
    let slash = type.lastIndexOf('/')
    if (slash === -1) return undefined
    let plural = type.slice(0, slash)
    let verb = type.slice(slash + 1)
    if (!VERBS.has(verb) || !tables[plural]) return undefined
    return [plural, verb]
  }

  async function applyFields(plural, schema, id, fields, meta) {
    let rows = await queryRows(
      driver,
      `SELECT "updatedAt" FROM "${plural}" WHERE "id" = ?`,
      [id]
    )
    let updatedAt = rows.length > 0 ? JSON.parse(rows[0].updatedAt) : {}
    let changes = {}
    for (let key in fields) {
      if (schema[key] && isFirstOlder(updatedAt[key], meta)) {
        changes[key] = fields[key]
        updatedAt[key] = meta.id
      }
    }
    let keys = Object.keys(changes)
    let values = keys.map(key => encodeValue(schema[key], changes[key]))
    if (rows.length === 0) {
      let names = ['id', ...keys, 'updatedAt'].map(i => `"${i}"`)
      let holes = names.map(() => '?')
      await driver.exec(
        `INSERT INTO "${plural}" (${names.join(', ')})` +
          ` VALUES (${holes.join(', ')})`,
        [id, ...values, JSON.stringify(updatedAt)]
      )
    } else if (keys.length > 0) {
      let sets = keys.map(key => `"${key}" = ?`)
      await driver.exec(
        `UPDATE "${plural}" SET ${sets.join(', ')}, "updatedAt" = ?` +
          ` WHERE "id" = ?`,
        [...values, JSON.stringify(updatedAt), id]
      )
    }
  }

  async function applyAction(action, meta) {
    let parsed = parseType(action.type)
    if (!parsed) return
    let [plural, verb] = parsed
    if (verb === 'delete' || verb === 'deleted') {
      await driver.exec(`DELETE FROM "${plural}" WHERE "id" = ?`, [action.id])
    } else {
      await applyFields(
        plural,
        tables[plural],
        action.id,
        action.fields ?? {},
        meta
      )
    }
  }

  function ready() {
    for (let entry of actionsWaiting) {
      queue = queue.then(() => applyAction(entry[0], entry[1]))
    }
    actionsWaiting = []
    status.set('ready')
    db.resume()
  }

  function outdated() {
    if (status.get() === 'outdated') return
    status.set('outdated')
    db.pause()
    stop()
    releaseLock()
  }

  void Promise.resolve().then(async () => {
    started = true
    hash = stringify(
      Object.fromEntries(
        Object.entries(tables).map(([plural, schema]) => [
          plural,
          Object.fromEntries(
            Object.entries(schema).map(([name, col]) => [
              name,
              { sql: col.sql, type: col.type, values: col.values }
            ])
          )
        ])
      )
    )

    window.addEventListener('storage', event => {
      if (event.key !== storageKey || event.newValue === null) return
      if (event.newValue !== hash) outdated()
    })

    let old = localStorage.getItem(storageKey)
    if (old === hash) {
      for (let plural in tables) {
        await driver.exec(createTableSql(plural, tables[plural], dialect), [])
      }
      ready()
    } else {
      if (old !== null) status.set('updating')
      for (let plural in tables) {
        await driver.exec(`DROP TABLE IF EXISTS "${plural}"`, [])
        await driver.exec(createTableSql(plural, tables[plural], dialect), [])
      }
      let entries = []
      await client.log.each((action, meta) => {
        if (parseType(action.type)) entries.unshift([action, meta])
      })
      if (old !== null && callbacks.repeat) {
        entries = entries.concat(await callbacks.repeat())
      }
      for (let entry of entries) {
        await applyAction(entry[0], entry[1])
      }
      localStorage.setItem(storageKey, hash)
      ready()
    }
  })

  if (typeof navigator !== 'undefined' && navigator.locks) {
    void navigator.locks.request(`${storageKey}:lock`, () => {
      if (status.get() === 'outdated') return Promise.resolve()
      isLeader = true
      return new Promise(resolve => {
        releaseLock = resolve
      })
    })
  } else {
    isLeader = true
  }

  client.on('add', (action, meta) => {
    if (!isLeader || status.get() === 'outdated') return
    if (!parseType(action.type)) return
    if (status.get() !== 'ready') {
      actionsWaiting.push([action, meta])
    } else {
      queue = queue.then(() => applyAction(action, meta))
    }
  })

  return {
    sql(template, ...params) {
      return db.store(template, ...params.map(i => encodeParam(i)))
    },
    status,
    table(plural, schema) {
      if (started) {
        throw new Error(
          'All tables must be defined synchronously ' +
            'after createCrdtDatabase() call'
        )
      }
      tables[plural] = schema
      return {
        async create(fields) {
          let { id = nanoid(), ...values } = fields
          for (let key in schema) {
            if (values[key] === undefined && 'default' in schema[key]) {
              let byDefault = schema[key].default
              values[key] =
                typeof byDefault === 'function' ? byDefault() : byDefault
            }
          }
          await client.log.add(
            { fields: serializeFields(values), id, type: `${plural}/create` },
            { sync: true }
          )
          return id
        },
        async delete(id) {
          await client.log.add(
            { id, type: `${plural}/delete` },
            { sync: true }
          )
        },
        plural,
        select(template, ...params) {
          let prefix = `SELECT "${plural}".* FROM "${plural}"`
          let parts = template
            ? [`${prefix} ${template[0]}`, ...template.slice(1)]
            : [prefix]
          return db.store(parts, ...params.map(i => encodeParam(i)))
        },
        async update(id, diff) {
          await client.log.add(
            { fields: serializeFields(diff), id, type: `${plural}/change` },
            { sync: true }
          )
        }
      }
    }
  }
}

function createTableSql(plural, schema, dialect) {
  let columns = ['"id" TEXT PRIMARY KEY']
  for (let name in schema) {
    columns.push(columnSql(name, schema[name], dialect))
  }
  columns.push('"updatedAt" TEXT')
  return `CREATE TABLE IF NOT EXISTS "${plural}" (${columns.join(', ')})`
}
