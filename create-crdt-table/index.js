import { isFirstOlder } from '@logux/core'
import stringify from 'fast-json-stable-stringify'
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
  for (let name in schema) {
    columns.push(columnSql(name, schema[name], dialect))
  }
  columns.push('"updatedAt" TEXT')
  return `CREATE TABLE IF NOT EXISTS "${plural}" (${columns.join(', ')})`
}

const VERBS = {
  changed: 1,
  created: 2,
  deleted: 3
}

const RESULT = ['', 0]

export function createCrdtDatabase(client, db, opts = {}) {
  let dialect = opts.dialect ?? 'sqlite'
  let storageKey = opts.key ?? 'logux:db'
  let stop = opts.stop ?? (() => {})
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
    if (!tables[plural]) return undefined
    let verb = VERBS[type.slice(slash + 1)]
    if (!verb) return undefined
    RESULT[0] = plural
    RESULT[1] = verb
    return RESULT
  }

  async function applyAction(action, meta) {
    let parsed = parseType(action.type)
    if (!parsed) return
    let [plural, verb] = parsed
    if (verb === VERBS.deleted) {
      await driver.exec(`DELETE FROM "${plural}" WHERE "id" = ?`, [action.id])
    } else {
      let existing = await driver.select(
        `SELECT "updatedAt" FROM "${plural}" WHERE "id" = ?`,
        [action.id]
      )
      let updatedAt = {}
      if (existing.length === 0) {
        if (verb === VERBS.changed) return
      } else {
        updatedAt = JSON.parse(existing[0].updatedAt)
      }
      if (existing.length === 0 && verb === VERBS.changed) return
      let changes = {}
      for (let key in action.fields ?? {}) {
        if (
          tables[plural][key] &&
          action.fields[key] !== undefined &&
          isFirstOlder(updatedAt[key], meta)
        ) {
          changes[key] = action.fields[key]
          updatedAt[key] = meta.id
        }
      }
      let keys = Object.keys(changes)
      if (keys.length > 0) {
        let values = keys.map(key => changes[key])
        if (verb === VERBS.created && existing.length === 0) {
          let names = ['id', ...keys, 'updatedAt'].map(i => `"${i}"`)
          await driver.exec(
            `INSERT INTO "${plural}" (${names.join(', ')})` +
              ` VALUES (${names.map(() => '?').join(', ')})`,
            [action.id, ...values, JSON.stringify(updatedAt)]
          )
        } else {
          let sets = keys.map(key => `"${key}" = ?`)
          await driver.exec(
            `UPDATE "${plural}" SET ${sets.join(', ')}, "updatedAt" = ?` +
              ` WHERE "id" = ?`,
            [...values, JSON.stringify(updatedAt), action.id]
          )
        }
      }
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
      if (event.newValue !== hash) {
        if (status.get() === 'outdated') return
        status.set('outdated')
        db.pause()
        stop()
        releaseLock()
      }
    })

    let old = localStorage.getItem(storageKey)
    if (old === hash) {
      for (let plural in tables) {
        await driver.exec(createTableSql(plural, tables[plural], dialect), [])
      }
      ready()
    } else {
      if (old !== null) {
        status.set('updating')
        for (let oldTable in JSON.parse(old)) {
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
    if (!isLeader || status.value === 'outdated') return
    if (!parseType(action.type)) return
    if (status.value !== 'ready') {
      actionsWaiting.push([action, meta])
    } else {
      queue = queue.then(() => applyAction(action, meta))
    }
  })

  return {
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
            { fields: values, id, type: `${plural}/created` },
            { sync: true }
          )
          return id
        },
        async delete(id) {
          await client.log.add(
            { id, type: `${plural}/deleted` },
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
            { fields: diff, id, type: `${plural}/changed` },
            { sync: true }
          )
        }
      }
    }
  }
}
