var VERSION = 1

function promisify (request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function (e) {
      resolve(e.target.result)
    }
    request.onerror = function (e) {
      reject(e.target.error)
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

  get: function get (order) {
    var request
    return this.init().then(function (store) {
      var log = store.os('log')
      if (order === 'created') {
        request = log.index('created').openCursor(null, 'prev')
      } else {
        request = log.openCursor(null, 'prev')
      }
      return promisify(request).then(nextEntry(request))
    })
  },

  has: function has (id) {
    return this.init().then(function (store) {
      return promisify(store.os('log').index('id').get(id))
    }).then(function (result) {
      return !!result
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

  remove: function remove (id) {
    return this.init().then(function (store) {
      var log = store.os('log', 'write')
      return promisify(log.index('id').get(id)).then(function (entry) {
        if (!entry) {
          return false
        } else {
          return promisify(log.delete(entry.added))
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
   * Remove all database and data from `indexedDB`.
   *
   * @return {Promise} Promise for end of removing
   *
   * @example
   * afterEach(() => this.store.destroy())
   */
  destroy: function destroy () {
    return this.init().then(function (store) {
      store.db.close()
      return promisify(global.indexedDB.deleteDatabase(store.name))
    })
  }

}

module.exports = IndexedStore
