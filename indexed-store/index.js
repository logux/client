import { isFirstOlder, toSorted } from '@logux/core'

function byCreated(a, b) {
  let first = toSorted(a[1])
  let second = toSorted(b[1])
  if (first === second) return 0
  return first < second ? -1 : 1
}

const VERSION = 3

function rejectify(request, reject) {
  request.onerror = e => {
    /* v8 ignore next 2 -- @preserve */
    reject(e.target.error)
  }
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    rejectify(request, reject)
    request.onsuccess = e => {
      resolve(e.target.result)
    }
  })
}

function isDefined(value) {
  return typeof value !== 'undefined'
}

function matchCriteria(entry, criteria) {
  let meta = entry.meta
  let c = criteria
  if (isDefined(c.ids) && !c.ids.includes(meta.id)) {
    return false
  }
  if (isDefined(c.index) && !entry.indexes.includes(c.index)) {
    return false
  }
  if (isDefined(c.olderThan) && !isFirstOlder(meta, c.olderThan)) {
    return false
  }
  if (isDefined(c.youngerThan) && !isFirstOlder(c.youngerThan, meta)) {
    return false
  }
  if (isDefined(c.minAdded) && entry.added < c.minAdded) {
    return false
  }
  if (isDefined(c.maxAdded) && entry.added > c.maxAdded) {
    return false
  }
  return true
}

/**
 * Change reasons of every action matching the criteria. Uses `criteria.id`,
 * `criteria.index`, or the single removing reason to avoid scanning
 * the whole log.
 *
 * The `change` callback returns the request to wait for, or `false`
 * if the action was not changed.
 */
async function changeReasons(store, criteria, reasons, change) {
  if (criteria.ids && criteria.ids.length === 0) return

  if (isDefined(criteria.id)) {
    let entry = await promisify(store.os('log').index('id').get(criteria.id))
    if (!entry || !matchCriteria(entry, criteria)) return
    let log = store.os('log', 'write')
    let process = change(entry, log)
    if (process) await promisify(process)
    return
  }

  await new Promise((resolve, reject) => {
    let log = store.os('log', 'write')
    let request
    if (isDefined(criteria.index)) {
      request = log.index('indexes').openCursor(criteria.index)
    } else if (reasons && reasons.length === 1) {
      request = log.index('reasons').openCursor(reasons[0])
    } else {
      request = log.openCursor()
    }
    rejectify(request, reject)

    request.onsuccess = e => {
      let cursor = e.target.result
      if (!cursor) {
        resolve()
        return
      }
      let entry = cursor.value
      let process = matchCriteria(entry, criteria) && change(entry, log)
      if (!process) {
        cursor.continue()
        return
      }
      rejectify(process, reject)
      process.onsuccess = () => {
        cursor.continue()
      }
    }
  })
}

export class IndexedStore {
  constructor(name = 'logux') {
    this.name = name
    this.adding = {}
  }

  async add(action, meta) {
    let entry = {
      action,
      id: meta.id,
      indexes: meta.indexes || [],
      meta,
      reasons: meta.reasons,
      time: meta.time
    }

    if (this.adding[entry.id]) {
      return false
    }
    this.adding[entry.id] = true

    let store = await this.init()
    let exist = await promisify(store.os('log').index('id').get(meta.id))
    if (exist) {
      return false
    } else {
      let added = await promisify(store.os('log', 'write').add(entry))
      delete store.adding[entry.id]
      meta.added = added
      return meta
    }
  }

  async addReason(reasons, criteria) {
    let store = await this.init()
    await changeReasons(store, criteria, undefined, (entry, log) => {
      let missing = reasons.filter(i => !entry.reasons.includes(i))
      if (missing.length === 0) return false
      entry.reasons = entry.reasons.concat(missing)
      entry.meta.reasons = entry.reasons
      return log.put(entry)
    })
  }

  async byId(id) {
    let store = await this.init()
    let result = await promisify(store.os('log').index('id').get(id))
    if (result) {
      return [result.action, result.meta]
    } else {
      return [null, null]
    }
  }

  async changeMeta(id, diff) {
    let store = await this.init()
    let entry = await promisify(store.os('log').index('id').get(id))
    if (!entry) {
      return false
    } else {
      for (let key in diff) entry.meta[key] = diff[key]
      if (diff.reasons) entry.reasons = diff.reasons
      await promisify(store.os('log', 'write').put(entry))
      return true
    }
  }

  async clean() {
    let store = await this.init()
    store.db.close()
    await promisify(indexedDB.deleteDatabase(store.name))
  }

  async get({ index, order, reason }) {
    let store = await this.init()
    return new Promise((resolve, reject) => {
      let log = store.os('log')
      let request
      if (index) {
        request = log
          .index('indexes')
          .openCursor(IDBKeyRange.only(index), 'prev')
      } else if (reason) {
        request = log
          .index('reasons')
          .openCursor(IDBKeyRange.only(reason), 'prev')
      } else {
        request = log.openCursor(null, 'prev')
      }
      rejectify(request, reject)

      let entries = []
      request.onsuccess = function (e) {
        let cursor = e.target.result
        if (!cursor) {
          // Cursors are ordered by `added`, so `created` order needs sorting
          if (order === 'created') entries.sort(byCreated)
          resolve({ entries })
          return
        }
        let entry = cursor.value
        if (
          (!index || entry.indexes.includes(index)) &&
          (!reason || entry.reasons.includes(reason))
        ) {
          entry.meta.added = entry.added
          entries.unshift([entry.action, entry.meta])
        }
        cursor.continue()
      }
    })
  }

  async getLastAdded() {
    let store = await this.init()
    let cursor = await promisify(store.os('log').openCursor(null, 'prev'))
    return cursor ? cursor.value.added : 0
  }

  async getLastSynced() {
    let store = await this.init()
    let data = await promisify(store.os('extra').get('lastSynced'))
    if (data) {
      return { received: data.received, sent: data.sent }
    } else {
      return { received: 0, sent: 0 }
    }
  }

  init() {
    if (this.initing) return this.initing

    let store = this
    let opening = indexedDB.open(this.name, VERSION)

    opening.onupgradeneeded = function (e) {
      let db = e.target.result

      let log
      if (e.oldVersion < 1) {
        log = db.createObjectStore('log', {
          autoIncrement: true,
          keyPath: 'added'
        })
        log.createIndex('id', 'id', { unique: true })
        log.createIndex('reasons', 'reasons', { multiEntry: true })
        db.createObjectStore('extra', { keyPath: 'key' })
      }
      if (e.oldVersion < 2) {
        if (!log) {
          /* v8 ignore next 2 -- @preserve */
          log = opening.transaction.objectStore('log')
        }
        log.createIndex('indexes', 'indexes', { multiEntry: true })
      }
      if (e.oldVersion > 0 && e.oldVersion < 3) {
        // Actions are sorted in JS now, `created` index is not used
        opening.transaction.objectStore('log').deleteIndex('created')
      }
    }

    this.initing = promisify(opening).then(db => {
      store.db = db
      db.onversionchange = function () {
        store.db.close()
        if (typeof document !== 'undefined' && document.reload) {
          document.reload()
        }
      }
      return store
    })

    return this.initing
  }

  os(name, write) {
    let mode = write ? 'readwrite' : 'readonly'
    return this.db.transaction(name, mode).objectStore(name)
  }

  async remove(id) {
    let store = await this.init()
    let entry = await promisify(store.os('log').index('id').get(id))
    if (!entry) {
      return false
    } else {
      await promisify(store.os('log', 'write').delete(entry.added))
      entry.meta.added = entry.added
      return [entry.action, entry.meta]
    }
  }

  async removeReason(reasons, criteria, callback) {
    let store = await this.init()
    await changeReasons(store, criteria, reasons, (entry, log) => {
      let kept = entry.reasons.filter(i => !reasons.includes(i))
      if (kept.length === entry.reasons.length) return false
      entry.reasons = kept
      entry.meta.reasons = kept
      if (kept.length > 0) return log.put(entry)
      entry.meta.added = entry.added
      callback(entry.action, entry.meta)
      return log.delete(entry.added)
    })
  }

  async setLastSynced(values) {
    let store = await this.init()
    let data = await promisify(store.os('extra').get('lastSynced'))
    if (!data) data = { key: 'lastSynced', received: 0, sent: 0 }
    if (typeof values.sent !== 'undefined') {
      data.sent = values.sent
    }
    if (typeof values.received !== 'undefined') {
      data.received = values.received
    }
    await promisify(store.os('extra', 'write').put(data))
  }
}
