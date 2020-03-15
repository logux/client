let isFirstOlder = require('@logux/core/is-first-older')

const VERSION = 1

function rejectify (request, reject) {
  request.onerror = e => {
    reject(e.target.error)
  }
}

function promisify (request) {
  return new Promise((resolve, reject) => {
    rejectify(request, reject)
    request.onsuccess = e => {
      resolve(e.target.result)
    }
  })
}

function nextEntry (request) {
  return cursor => {
    if (cursor) {
      cursor.value.meta.added = cursor.value.added
      return {
        entries: [[cursor.value.action, cursor.value.meta]],
        next () {
          cursor.continue()
          return promisify(request).then(nextEntry(request))
        }
      }
    } else {
      return { entries: [] }
    }
  }
}

function isDefined (value) {
  return typeof value !== 'undefined'
}

/**
 * `IndexedDB` store for Logux log.
 *
 * @param {string} [name="logux"] Database name to run multiple
 *                                Logux instances on same web page.
 *
 * @class
 * @extends Store
 *
 * @example
 * import IndexedStore from '@logux/client/indexed-store'
 * const client = new CrossTabClient({
 *   …,
 *   store: new IndexedStore()
 * })
 *
 * @example
 * import IndexedStore from '@logux/client/indexed-store'
 * const createStore = createLoguxCreator({
 *   …,
 *   store: new IndexedStore()
 * })
 */
class IndexedStore {
  constructor (name = 'logux') {
    this.name = name
    this.adding = { }
  }

  init () {
    if (this.initing) return this.initing

    let store = this
    let opening = indexedDB.open(this.name, VERSION)

    opening.onupgradeneeded = function (e) {
      let db = e.target.result

      let log = db.createObjectStore('log', {
        keyPath: 'added',
        autoIncrement: true
      })
      log.createIndex('id', 'id', { unique: true })
      log.createIndex('created', 'created', { unique: true })
      log.createIndex('reasons', 'reasons', { multiEntry: true })

      db.createObjectStore('extra', { keyPath: 'key' })
    }

    this.initing = promisify(opening).then(db => {
      store.db = db
      db.onversionchange = function () {
        store.db.close()
        if (global.document && global.document.reload) {
          global.document.reload()
        }
      }
      return store
    })

    return this.initing
  }

  get (opts) {
    let request
    return this.init().then(store => {
      let log = store.os('log')
      if (opts.order === 'created') {
        request = log.index('created').openCursor(null, 'prev')
      } else {
        request = log.openCursor(null, 'prev')
      }
      return promisify(request).then(nextEntry(request))
    })
  }

  byId (id) {
    return this.init().then(store => {
      return promisify(store.os('log').index('id').get(id))
    }).then(result => {
      if (result) {
        return [result.action, result.meta]
      } else {
        return [null, null]
      }
    })
  }

  remove (id) {
    return this.init().then(store => {
      let log = store.os('log', 'write')
      return promisify(log.index('id').get(id)).then(entry => {
        if (!entry) {
          return false
        } else {
          return promisify(log.delete(entry.added)).then(() => {
            entry.meta.added = entry.added
            return [entry.action, entry.meta]
          })
        }
      })
    })
  }

  add (action, meta) {
    let id = meta.id.split(' ')
    let entry = {
      id: meta.id,
      meta,
      time: meta.time,
      action,
      reasons: meta.reasons,
      created: [meta.time, id[1], id[2], id[0]].join(' ')
    }

    if (this.adding[entry.created]) {
      return new Promise(resolve => {
        resolve(false)
      })
    }
    this.adding[entry.created] = true

    return this.init().then(store => {
      let log = store.os('log', 'write')
      return promisify(log.index('id').get(meta.id)).then(exist => {
        if (exist) {
          return false
        } else {
          return promisify(log.add(entry)).then(added => {
            delete store.adding[entry.created]
            meta.added = added
            return meta
          })
        }
      })
    })
  }

  changeMeta (id, diff) {
    return this.init().then(store => {
      let log = store.os('log', 'write')
      return promisify(log.index('id').get(id)).then(entry => {
        if (!entry) {
          return false
        } else {
          for (let key in diff) entry.meta[key] = diff[key]
          if (diff.reasons) entry.reasons = diff.reasons
          return promisify(log.put(entry)).then(() => {
            return true
          })
        }
      })
    })
  }

  removeReason (reason, criteria, callback) {
    return this.init().then(store => {
      let log = store.os('log', 'write')
      if (criteria.id) {
        return promisify(log.index('id').get(criteria.id))
          .then(entry => {
            if (!entry) {
              return Promise.resolve()
            }
            let index = entry.meta.reasons.indexOf(reason)
            if (index !== -1) {
              entry.meta.reasons.splice(index, 1)
              entry.reasons = entry.meta.reasons
              if (entry.meta.reasons.length === 0) {
                callback(entry.action, entry.meta)
                return promisify(log.delete(entry.added))
              } else {
                return promisify(log.put(entry))
              }
            } else {
              return Promise.resolve()
            }
          })
      } else {
        let request = log.index('reasons').openCursor(reason)
        return new Promise((resolve, reject) => {
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
    })
  }

  getLastAdded () {
    return this.init().then(store => {
      return promisify(store.os('log').openCursor(null, 'prev'))
    }).then(cursor => {
      return cursor ? cursor.value.added : 0
    })
  }

  getLastSynced () {
    return this.init().then(store => {
      return promisify(store.os('extra').get('lastSynced'))
    }).then(data => {
      if (data) {
        return { sent: data.sent, received: data.received }
      } else {
        return { sent: 0, received: 0 }
      }
    })
  }

  setLastSynced (values) {
    return this.init().then(store => {
      let extra = store.os('extra', 'write')
      return promisify(extra.get('lastSynced')).then(data => {
        if (!data) data = { key: 'lastSynced', sent: 0, received: 0 }
        if (typeof values.sent !== 'undefined') {
          data.sent = values.sent
        }
        if (typeof values.received !== 'undefined') {
          data.received = values.received
        }
        return promisify(extra.put(data))
      })
    })
  }

  os (name, write) {
    let mode = write ? 'readwrite' : 'readonly'
    return this.db.transaction(name, mode).objectStore(name)
  }

  /**
   * Remove all database and data from `IndexedDB`.
   *
   * @return {Promise} Promise for end of removing
   *
   * @example
   * afterEach(() => this.store.clean())
   */
  clean () {
    return this.init().then(store => {
      store.db.close()
      return promisify(global.indexedDB.deleteDatabase(store.name))
    })
  }
}

module.exports = IndexedStore
