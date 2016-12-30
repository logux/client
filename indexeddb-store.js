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
        var fillExtra = false

        openRequest.onupgradeneeded = function (e) {
          var thisDb = e.target.result
          var logOS
          var extraOS

          // Create log OS
          if (!thisDb.objectStoreNames.contains('log')) {
            logOS = thisDb.createObjectStore('log',
              { keyPath: 'added', autoIncrement: true })
            logOS.createIndex('id', 'id', { unique: true })
            logOS.createIndex('time', 'time', { unique: false })
            logOS.createIndex('created', 'created', { unique: true })
          }
          // Create extra OS
          if (!thisDb.objectStoreNames.contains('extra')) {
            extraOS = thisDb.createObjectStore('extra', { keyPath: 'key' })
            fillExtra = true
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
          if (fillExtra) {
            var t = store.db.transaction(['extra'], 'readwrite')
            var os = t.objectStore('extra')
            os.add({ key: 'lastSynced', sent: 0, received: 0 })
          }
          resolve(store)
        }
      }
    })
  },

  get: function get (order, pageSize) {
    pageSize = pageSize || 20
    return this.init().then(function (store) {
      var t = store.db.transaction(['log'], 'readonly')
      return new Promise(function (resolve) {
        var log = []
        var cnt = 0

        var cursorCall
        var meta = {}
        if (order === 'created') {
          var ind = t.objectStore('log').index('created')
          cursorCall = ind.openCursor(null, 'prev')
        } else {
          cursorCall = t.objectStore('log').openCursor(null, 'prev')
        }
        cursorCall.onsuccess = function (event) {
          var cursor = event.target.result
          if (cursor) {
            meta = {}
            meta.id = cursor.value.id
            meta.time = cursor.value.time
            meta.added = cursor.value.added

            log.push([cursor.value.action, meta])

            cnt += 1
            if (cnt === pageSize) {
              resolve({ entries: log })
            } else {
              cursor.continue()
            }
          } else {
            resolve({ entries: log })
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

      var t = store.db.transaction(['log'], 'readwrite')
      var dt = Date.now()
      return new Promise(function (resolve) {
        var req = t.objectStore('log').add(objToAdd)
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
      var t = store.db.transaction(['log'], 'readwrite')
      return new Promise(function (resolve) {
        var req = t.objectStore('log').index('id').get(id)
        req.onsuccess = function () {
          if (!req.result) {
            resolve(false)
          } else {
            var del = t.objectStore('log').delete(req.result.added)
            del.onsuccess = function () {
              resolve(true)
            }
          }
        }
      })
    })
  },

  getLastAdded: function getLastAdded () {
    return this.get('added', 1).then(function (page) {
      if (page.entries.length === 1) {
        return Promise.resolve(page.entries[0][1].added)
      } else {
        return Promise.resolve(0)
      }
    })
  },

  getLastSynced: function getLastSynced () {
    return this.init().then(function (store) {
      var t = store.db.transaction(['extra'])
      return new Promise(function (resolve) {
        var req = t.objectStore('extra').get('lastSynced')
        req.onsuccess = function (event) {
          resolve({
            sent: req.result.sent,
            received: req.result.received
          })
        }
        req.onerror = function () {
          resolve(false)
        }
      })
    })
  },

  setLastSynced: function setLastSynced (values) {
    return this.init().then(function (store) {
      var t = store.db.transaction(['extra'], 'readwrite')
      var os = t.objectStore('extra')
      return new Promise(function (resolve) {
        var req = os.get('lastSynced')
        req.onsuccess = function () {
          res = req.result
          if (typeof values.sent !== 'undefined') {
            res.sent = values.sent
          }
          if (typeof values.received !== 'undefined') {
            res.received = values.received
          }

          updateReq = os.put(res)
          updateReq.onsuccess = function () {
            resolve()
          }
        }
      })
    })
  }

}

module.exports = IndexedDBStore
