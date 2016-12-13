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
            objectStore.createIndex('type', 'type', { unique: false })
            objectStore.createIndex('created', 'created', { unique: true })
            objectStore.createIndex('data', 'data', { unique: false })
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
        var entry = {}
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
            entry = {}
            meta.created = cursor.value.created
            meta.added = cursor.value.added
            entry = cursor.value.data
            entry.type = cursor.value.type

            entries.push([entry, meta])

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

  add: function add (entry) {
    return this.init().then(function (store) {
      var objToAdd = {
        type: entry[0].type,
        created: entry[1].created,
        data: {}
      }
      if (entry[1].added) {
        objToAdd.added = entry[1].added
      }
      for (var key in entry[0]) {
        if (key !== 'type') {
          objToAdd.data[key] = entry[0][key]
        }
      }

      var t = store.db.transaction(['entries'], 'readwrite')
      return new Promise(function (resolve) {
        var req = t.objectStore('entries').add(objToAdd)
        req.onsuccess = function (event) {
          resolve(event.target.result === objToAdd.added)
        }
        req.onerror = function () {
          resolve(false)
        }
      })
    })
  },

  remove: function remove (time) {
    return this.init().then(function (store) {
      var t = store.db.transaction(['entries'], 'readwrite')
      return new Promise(function (resolve) {
        var req = t.objectStore('entries').index('created').get(time)
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
