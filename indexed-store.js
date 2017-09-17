var isFirstOlder = require('logux-core/is-first-older')

var VERSION = 1

function rejectify (request, reject) {
  request.onerror = function (e) {
    reject(e.target.error)
  }
}

function promisify (request) {
  return new Promise(function (resolve, reject) {
    rejectify(request, reject)
    request.onsuccess = function (e) {
      resolve(e.target.result)
    }
  })
}

function nextEntry (request) {
  return function (cursor) {
    if (cursor) {
      cursor.value.meta.added = cursor.value.added
      return {
        entries: [[cursor.value.action, cursor.value.meta]],
        next: function () {
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
 * import IndexedStore from 'logux-client/indexed-store'
 * var log = new Log({ store: new IndexedStore(), nodeId })
 */
function IndexedStore (name) {
  this.name = name || 'logux'
}

IndexedStore.prototype = {

  init: function init () {
    if (this.initing) return this.initing

    var store = this
    var opening = indexedDB.open(this.name, VERSION)

    opening.onupgradeneeded = function (e) {
      var db = e.target.result

      var log = db.createObjectStore('log', {
        keyPath: 'added',
        autoIncrement: true
      })
      log.createIndex('id', 'id', { unique: true })
      log.createIndex('created', 'created', { unique: true })
      log.createIndex('reasons', 'reasons', { multiEntry: true })

      db.createObjectStore('extra', { keyPath: 'key' })
        .transaction.oncomplete = function () {
          db.transaction('extra', 'readwrite')
            .objectStore('extra')
            .add({ key: 'lastSynced', sent: 0, received: 0 })
        }
    }

    this.initing = promisify(opening).then(function (db) {
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
  },

  get: function get (opts) {
    var request
    return this.init().then(function (store) {
      var log = store.os('log')
      if (opts.order === 'created') {
        request = log.index('created').openCursor(null, 'prev')
      } else {
        request = log.openCursor(null, 'prev')
      }
      return promisify(request).then(nextEntry(request))
    })
  },

  byId: function byId (id) {
    return this.init().then(function (store) {
      return promisify(store.os('log').index('id').get(id))
    }).then(function (result) {
      if (result) {
        return [result.action, result.meta]
      } else {
        return [null, null]
      }
    })
  },

  remove: function remove (id) {
    return this.init().then(function (store) {
      var log = store.os('log', 'write')
      return promisify(log.index('id').get(id)).then(function (entry) {
        if (!entry) {
          return false
        } else {
          return promisify(log.delete(entry.added)).then(function () {
            entry.meta.added = entry.added
            return [entry.action, entry.meta]
          })
        }
      })
    })
  },

  add: function add (action, meta) {
    var entry = {
      id: meta.id,
      meta: meta,
      time: meta.time,
      action: action,
      reasons: meta.reasons,
      created: meta.time + '\t' + meta.id.slice(1).join('\t')
    }

    return this.init().then(function (store) {
      var log = store.os('log', 'write')
      return promisify(log.index('id').get(meta.id)).then(function (exist) {
        if (exist) {
          return false
        } else {
          return promisify(log.add(entry)).then(function (added) {
            meta.added = added
            return meta
          })
        }
      })
    })
  },

  changeMeta: function changeMeta (id, diff) {
    return this.init().then(function (store) {
      var log = store.os('log', 'write')
      return promisify(log.index('id').get(id)).then(function (entry) {
        if (!entry) {
          return false
        } else {
          for (var key in diff) entry.meta[key] = diff[key]
          if (diff.reasons) entry.reasons = diff.reasons
          return promisify(log.put(entry)).then(function () {
            return true
          })
        }
      })
    })
  },

  removeReason: function removeReason (reason, criteria, callback) {
    return this.init().then(function (store) {
      var log = store.os('log', 'write')
      var request = log.index('reasons').openCursor(reason)
      return new Promise(function (resolve, reject) {
        rejectify(request, reject)
        request.onsuccess = function (e) {
          if (!e.target.result) {
            resolve()
            return
          }

          var entry = e.target.result.value
          var meta = entry.meta
          var c = criteria

          if (isDefined(c.olderThan) && !isFirstOlder(meta, c.olderThan)) {
            e.target.result.continue()
            return
          }
          if (isDefined(c.youngerThan) && !isFirstOlder(c.youngerThan, meta)) {
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

          var process
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
    })
  },

  getLastAdded: function getLastAdded () {
    return this.init().then(function (store) {
      return promisify(store.os('log').openCursor(null, 'prev'))
    }).then(function (cursor) {
      return cursor ? cursor.value.added : 0
    })
  },

  getLastSynced: function getLastSynced () {
    return this.init().then(function (store) {
      return promisify(store.os('extra').get('lastSynced'))
    }).then(function (data) {
      return { sent: data.sent, received: data.received }
    })
  },

  setLastSynced: function setLastSynced (values) {
    return this.init().then(function (store) {
      var extra = store.os('extra', 'write')
      return promisify(extra.get('lastSynced')).then(function (data) {
        if (typeof values.sent !== 'undefined') {
          data.sent = values.sent
        }
        if (typeof values.received !== 'undefined') {
          data.received = values.received
        }
        return promisify(extra.put(data))
      })
    })
  },

  os: function os (name, write) {
    var mode = write ? 'readwrite' : 'readonly'
    return this.db.transaction(name, mode).objectStore(name)
  },

  /**
   * Remove all database and data from `IndexedDB`.
   *
   * @return {Promise} Promise for end of removing
   *
   * @example
   * afterEach(() => this.store.clean())
   */
  clean: function clean () {
    return this.init().then(function (store) {
      store.db.close()
      return promisify(global.indexedDB.deleteDatabase(store.name))
    })
  }

}

module.exports = IndexedStore
