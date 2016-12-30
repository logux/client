/**
 * Simple events store based on IndexedDB.
 *
 * @example
 * import { IndexedDBStore } from 'logux-core'
 *
 * var log = new Log({
 *   store: new IndexedDBStore(),
 *   timer: createTestTimer()
 * })
 *
 * @class
 * @extends Store
 */
function IndexedDBStore () {
  this.setUp = false
  this.systemDb = undefined
  this.db = undefined
  this.dbName = undefined
}

IndexedDBStore.prototype = {

  init: function init (dbName) {
    dbName = dbName || 'loguxLog'
    var store = this
    return new Promise(function (resolve, reject) {
      if (store.setUp) {
        resolve(store)
      } else {
        var indexedDB = window.indexedDB ||
                        window.mozIndexedDB ||
                        window.webkitIndexedDB ||
                        window.msIndexedDB

        var openRequest = indexedDB.open(dbName, 1)

        openRequest.onupgradeneeded = function (e) {
          var thisDb = e.target.result
          var objectStore

          // Create entries OS
          if (!thisDb.objectStoreNames.contains('entries')) {
            objectStore = thisDb.createObjectStore('entries',
              { keyPath: 'added', autoIncrement: true })
            objectStore.createIndex('id', 'id', { unique: true })
            objectStore.createIndex('time', 'time', { unique: false })
            objectStore.createIndex('created', 'created', { unique: true })
          }
        }

        openRequest.onsuccess = function (e) {
          store.db = e.target.result

          store.db.onerror = function (err) {
            // Generic error handler for all errors targeted at this database's
            // requests!
            reject(err)
          }

          store.setUp = true
          store.dbName = dbName
          resolve(store)
        }
      }
    })
  },

  get: function get (order, pageSize) {
    pageSize = pageSize || 20
    return this.init().then(function (store) {
      var t = store.db.transaction(['entries'], 'readonly')
      return new Promise(function (resolve) {
        var entries = []
        var cnt = 0

        var cursorCall
        var meta = {}
        if (order === 'created') {
          var ind = t.objectStore('entries').index('created')
          cursorCall = ind.openCursor(null, 'prev')
        } else {
          cursorCall = t.objectStore('entries').openCursor(null, 'prev')
        }
        cursorCall.onsuccess = function (event) {
          var cursor = event.target.result
          if (cursor) {
            meta = {}
            meta.id = cursor.value.id
            meta.time = cursor.value.time
            meta.added = cursor.value.added

            entries.push([cursor.value.action, meta])

            cnt += 1
            if (cnt === pageSize) {
              resolve({ entries: entries })
            } else {
              cursor.continue()
            }
          } else {
            resolve({ entries: entries })
          }
        }
      })
    })
  },

  add: function add (action, meta) {
    return this.init().then(function (store) {
      var objToAdd = {
        action: action,
        id: meta.id,
        time: meta.time,
        created: `${meta.time}\t${meta.id.slice(1).join('\t')}`
      }
      if (meta.added) {
        objToAdd.added = meta.added
      }

      var t = store.db.transaction(['entries'], 'readwrite')
      var dt = Date.now()
      return new Promise(function (resolve) {
        var req = t.objectStore('entries').add(objToAdd)
        req.onsuccess = function (event) {
          resolve(event.target.result)
        }
        req.onerror = function (err) {
          t.abort()
          resolve(false)
        }
      })
    })
  },

  remove: function remove (id) {
    return this.init().then(function (store) {
      var t = store.db.transaction(['entries'], 'readwrite')
      return new Promise(function (resolve) {
        var req = t.objectStore('entries').index('id').get(id)
        req.onsuccess = function () {
          if (!req.result) {
            resolve(false)
          } else {
            var del = t.objectStore('entries').delete(req.result.added)
            del.onsuccess = function () {
              resolve(true)
            }
          }
        }
      })
    })
  }

}

module.exports = IndexedDBStore
