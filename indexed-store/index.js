import { isFirstOlder } from '@logux/core'

const VERSION = 2

function rejectify(request, reject) {
  request.onerror = e => {
    /* istanbul ignore next */
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

export class IndexedStore {
  constructor(name = 'logux') {
    this.name = name
    this.adding = {}
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
          keyPath: 'added',
          autoIncrement: true
        })
        log.createIndex('id', 'id', { unique: true })
        log.createIndex('created', 'created', { unique: true })
        log.createIndex('reasons', 'reasons', { multiEntry: true })
        db.createObjectStore('extra', { keyPath: 'key' })
      }
      if (e.oldVersion < 2) {
        if (!log) {
          /* istanbul ignore next */
          log = opening.transaction.objectStore('log')
        }
        log.createIndex('indexes', 'indexes', { multiEntry: true })
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

  async get({ index, order }) {
    let store = await this.init()
    return new Promise((resolve, reject) => {
      let log = store.os('log')
      let request
      if (index) {
        if (order === 'created') {
          request = log.index('created').openCursor(null, 'prev')
        } else {
          let keyRange = IDBKeyRange.only(index)
          request = log.index('indexes').openCursor(keyRange, 'prev')
        }
      } else if (order === 'created') {
        request = log.index('created').openCursor(null, 'prev')
      } else {
        request = log.openCursor(null, 'prev')
      }
      rejectify(request, reject)

      let entries = []
      request.onsuccess = function (e) {
        let cursor = e.target.result
        if (!cursor) {
          resolve({ entries })
          return
        }
        if (!index || cursor.value.indexes.includes(index)) {
          cursor.value.meta.added = cursor.value.added
          entries.unshift([cursor.value.action, cursor.value.meta])
        }
        cursor.continue()
      }
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

  async add(action, meta) {
    let id = meta.id.split(' ')
    let entry = {
      id: meta.id,
      meta,
      time: meta.time,
      action,
      reasons: meta.reasons,
      indexes: meta.indexes || [],
      created: [meta.time, id[1], id[2], id[0]].join(' ')
    }

    if (this.adding[entry.created]) {
      return false
    }
    this.adding[entry.created] = true

    let store = await this.init()
    let exist = await promisify(store.os('log').index('id').get(meta.id))
    if (exist) {
      return false
    } else {
      let added = await promisify(store.os('log', 'write').add(entry))
      delete store.adding[entry.created]
      meta.added = added
      return meta
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

  async removeReason(reason, criteria, callback) {
    let store = await this.init()
    if (criteria.id) {
      let entry = await promisify(store.os('log').index('id').get(criteria.id))
      if (entry) {
        let index = entry.meta.reasons.indexOf(reason)
        if (index !== -1) {
          entry.meta.reasons.splice(index, 1)
          entry.reasons = entry.meta.reasons
          if (entry.meta.reasons.length === 0) {
            callback(entry.action, entry.meta)
            await promisify(store.os('log', 'write').delete(entry.added))
          } else {
            await promisify(store.os('log', 'write').put(entry))
          }
        }
      }
    } else {
      await new Promise((resolve, reject) => {
        let log = store.os('log', 'write')
        let request = log.index('reasons').openCursor(reason)
        rejectify(request, reject)
        request.onsuccess = function (e) {
          if (!e.target.result) {
            resolve()
            return
          }

          let entry = e.target.result.value
          let m = entry.meta
          let c = criteria

          if (isDefined(c.olderThan) && !isFirstOlder(m, c.olderThan)) {
            e.target.result.continue()
            return
          }
          if (isDefined(c.youngerThan) && !isFirstOlder(c.youngerThan, m)) {
            e.target.result.continue()
            return
          }
          if (isDefined(c.minAdded) && entry.added < c.minAdded) {
            e.target.result.continue()
            return
          }
          if (isDefined(c.maxAdded) && entry.added > c.maxAdded) {
            e.target.result.continue()
            return
          }

          let process
          if (entry.reasons.length === 1) {
            entry.meta.reasons = []
            entry.meta.added = entry.added
            callback(entry.action, entry.meta)
            process = log.delete(entry.added)
          } else {
            entry.reasons.splice(entry.reasons.indexOf(reason), 1)
            entry.meta.reasons = entry.reasons
            process = log.put(entry)
          }

          rejectify(process, reject)
          process.onsuccess = function () {
            e.target.result.continue()
          }
        }
      })
    }
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
      return { sent: data.sent, received: data.received }
    } else {
      return { sent: 0, received: 0 }
    }
  }

  async setLastSynced(values) {
    let store = await this.init()
    let data = await promisify(store.os('extra').get('lastSynced'))
    if (!data) data = { key: 'lastSynced', sent: 0, received: 0 }
    if (typeof values.sent !== 'undefined') {
      data.sent = values.sent
    }
    if (typeof values.received !== 'undefined') {
      data.received = values.received
    }
    await promisify(store.os('extra', 'write').put(data))
  }

  os(name, write) {
    let mode = write ? 'readwrite' : 'readonly'
    return this.db.transaction(name, mode).objectStore(name)
  }

  async clean() {
    let store = await this.init()
    store.db.close()
    await promisify(indexedDB.deleteDatabase(store.name))
  }
}
