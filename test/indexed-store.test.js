/* eslint-disable no-invalid-this */

var fakeIndexedDB = require('fake-indexeddb')
var TestTime = require('logux-core').TestTime

var IndexedStore = require('../indexed-store')

var originIndexedDB = global.indexedDB
beforeEach(function () {
  global.indexedDB = fakeIndexedDB
})

var store, other

afterEach(function () {
  return Promise.all([
    store ? store.destroy() : null,
    other ? other.destroy() : null
  ]).then(function () {
    store = undefined
    other = undefined
    global.indexedDB = originIndexedDB
    delete global.document.reload
  })
})

function all (request, list) {
  if (!list) list = []
  return request.then(function (page) {
    list = list.concat(page.entries)
    if (page.next) {
      return all(page.next(), list)
    } else {
      return list
    }
  })
}

function check (indexed, created, added) {
  if (!added) added = created
  return all(indexed.get({ order: 'created' })).then(function (entries) {
    expect(entries).toEqual(created)
  }).then(function () {
    return all(indexed.get({ order: 'added' }))
  }).then(function (entries) {
    expect(entries).toEqual(added)
  })
}

function nope () { }

it('use logux as default name', function () {
  store = new IndexedStore()
  return store.init().then(function () {
    expect(store.db.name).toEqual('logux')
    expect(store.name).toEqual('logux')
  })
})

it('allows to change DB name', function () {
  store = new IndexedStore('custom')
  return store.init().then(function () {
    expect(store.db.name).toEqual('custom')
    expect(store.name).toEqual('custom')
  })
})

it('is empty in the beginning', function () {
  store = new IndexedStore()
  return check(store, []).then(function () {
    return store.getLastAdded()
  }).then(function (added) {
    expect(added).toEqual(0)
    return store.getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual({ sent: 0, received: 0 })
  })
})

it('updates last sent value', function () {
  store = new IndexedStore()
  return store.setLastSynced({ sent: 1 }).then(function () {
    return store.getLastSynced()
  }).then(function (synced) {
    return expect(synced).toEqual({ sent: 1, received: 0 })
  }).then(function () {
    return store.setLastSynced({ sent: 2, received: 1 })
  }).then(function () {
    return store.getLastSynced()
  }).then(function (synced) {
    return expect(synced).toEqual({ sent: 2, received: 1 })
  }).then(function () {
    other = new IndexedStore(store.name)
    return other.getLastSynced()
  }).then(function (synced) {
    return expect(synced).toEqual({ sent: 2, received: 1 })
  })
})

it('stores entries sorted', function () {
  store = new IndexedStore()
  return Promise.all([
    store.add({ type: '1' }, { id: [1, 'a'], time: 1 }),
    store.add({ type: '2' }, { id: [1, 'c'], time: 2 }),
    store.add({ type: '3' }, { id: [1, 'b'], time: 2 })
  ]).then(function () {
    return check(store, [
      [{ type: '2' }, { added: 2, id: [1, 'c'], time: 2 }],
      [{ type: '3' }, { added: 3, id: [1, 'b'], time: 2 }],
      [{ type: '1' }, { added: 1, id: [1, 'a'], time: 1 }]
    ], [
      [{ type: '3' }, { added: 3, id: [1, 'b'], time: 2 }],
      [{ type: '2' }, { added: 2, id: [1, 'c'], time: 2 }],
      [{ type: '1' }, { added: 1, id: [1, 'a'], time: 1 }]
    ])
  })
})

it('stores any metadata', function () {
  store = new IndexedStore()
  return store.add(
    { type: 'A' },
    { id: [1, 'a'], time: 1, test: 1 }
  ).then(function () {
    return check(store, [
      [{ type: 'A' }, { added: 1, id: [1, 'a'], time: 1, test: 1 }]
    ])
  })
})

it('ignores entries with same ID', function () {
  store = new IndexedStore()
  var id = [1, 'a', 1]
  return store.add({ a: 1 }, { id: id, time: 1 }).then(function (meta) {
    expect(meta).toEqual({ id: id, time: 1, added: 1 })
    return store.add({ a: 2 }, { id: id, time: 2 })
  }).then(function (meta) {
    expect(meta).toBeFalsy()
    return check(store, [
      [{ a: 1 }, { id: id, time: 1, added: 1 }]
    ])
  })
})

it('returns last added', function () {
  store = new IndexedStore()
  return store.add({ type: 'A' }, { id: [1], time: 1 }).then(function () {
    return store.add({ type: 'B' }, { id: [2], time: 2 })
  }).then(function () {
    return store.getLastAdded()
  }).then(function (added) {
    return expect(added).toBe(2)
  }).then(function () {
    other = new IndexedStore(store.name)
    return other.getLastAdded()
  }).then(function (added) {
    return expect(added).toBe(2)
  })
})

it('reloads page on database update', function () {
  document.reload = jest.fn()
  store = new IndexedStore()
  return store.init().then(function () {
    var opening = indexedDB.open(store.name, 1000)
    return new Promise(function (resolve, reject) {
      opening.onsuccess = function (e) {
        e.target.result.close()
        resolve()
      }
      opening.onerror = function (e) {
        reject(e.target.error)
      }
    })
  }).then(function () {
    expect(document.reload).toHaveBeenCalled()
  })
})

it('checks that action ID is used in log', function () {
  store = new IndexedStore()
  return store.add({ type: 'A' }, { id: [1], time: 1 }).then(function () {
    return store.has([1])
  }).then(function (result) {
    expect(result).toBeTruthy()
    return store.has([2])
  }).then(function (result) {
    expect(result).toBeFalsy()
  })
})

it('changes meta', function () {
  store = new IndexedStore()
  return store.add({ }, { id: [1], time: 1, a: 1 }).then(function () {
    return store.changeMeta([1], { a: 2, b: 2 })
  }).then(function (result) {
    expect(result).toBeTruthy()
    return check(store, [
      [{ }, { id: [1], time: 1, added: 1, a: 2, b: 2 }]
    ])
  })
})

it('resolves to false on unknown ID in changeMeta', function () {
  store = new IndexedStore()
  return store.changeMeta([1], { a: 1 }).then(function (result) {
    expect(result).toBeFalsy()
  })
})

it('works with real log', function () {
  store = new IndexedStore()
  var log = TestTime.getLog({ store: store })
  var entries = []
  return Promise.all([
    log.add({ type: 'A' }, { id: [2], reasons: ['test'] }),
    log.add({ type: 'B' }, { id: [1], reasons: ['test'] })
  ]).then(function () {
    return log.each(function (action) {
      entries.push(action)
    })
  }).then(function () {
    expect(entries).toEqual([{ type: 'A' }, { type: 'B' }])
  })
})

it('removes entries', function () {
  store = new IndexedStore()
  return Promise.all([
    store.add({ type: '1' }, { id: [1, 'node', 0], time: 1 }),
    store.add({ type: '2' }, { id: [2, 'node', 0], time: 2 }),
    store.add({ type: '3' }, { id: [3, 'node', 0], time: 3 })
  ]).then(function () {
    return store.remove([2, 'node', 0])
  }).then(function (entry) {
    expect(entry).toEqual([
      { type: '2' }, { id: [2, 'node', 0], time: 2, added: 2 }
    ])
    return check(store, [
      [{ type: '3' }, { id: [3, 'node', 0], time: 3, added: 3 }],
      [{ type: '1' }, { id: [1, 'node', 0], time: 1, added: 1 }]
    ])
  })
})

it('ignores unknown entry', function () {
  store = new IndexedStore()
  return store.remove([2]).then(function (removed) {
    expect(removed).toBeFalsy()
  })
})

it('throws a errors', function () {
  var error = new Error()
  global.indexedDB = {
    open: function () {
      var request = { }
      setTimeout(function () {
        request.onerror({ target: { error: error } })
      }, 1)
      return request
    }
  }
  var broken = new IndexedStore()
  var throwed
  return broken.init().catch(function (e) {
    throwed = e
  }).then(function () {
    expect(throwed).toBe(error)
  })
})

it('removes reasons and actions without reason', function () {
  store = new IndexedStore()
  var removed = []
  return Promise.all([
    store.add({ type: '1' }, { id: [1], time: 1, reasons: ['a'] }),
    store.add({ type: '2' }, { id: [2], time: 2, reasons: ['a'] }),
    store.add({ type: '3' }, { id: [3], time: 3, reasons: ['a', 'b'] }),
    store.add({ type: '4' }, { id: [4], time: 4, reasons: ['b'] })
  ]).then(function () {
    return store.removeReason('a', { }, function (action, meta) {
      removed.push([action, meta])
    })
  }).then(function () {
    expect(removed).toEqual([
      [{ type: '1' }, { added: 1, id: [1], time: 1, reasons: [] }],
      [{ type: '2' }, { added: 2, id: [2], time: 2, reasons: [] }]
    ])
    return check(store, [
      [{ type: '4' }, { added: 4, id: [4], time: 4, reasons: ['b'] }],
      [{ type: '3' }, { added: 3, id: [3], time: 3, reasons: ['b'] }]
    ])
  })
})

it('removes reason with minimum added', function () {
  store = new IndexedStore()
  return Promise.all([
    store.add({ type: '1' }, { id: [1], time: 1, reasons: ['a'] }),
    store.add({ type: '2' }, { id: [2], time: 2, reasons: ['a'] }),
    store.add({ type: '3' }, { id: [3], time: 3, reasons: ['a'] })
  ]).then(function () {
    return store.removeReason('a', { minAdded: 2 }, nope)
  }).then(function () {
    return check(store, [
      [{ type: '1' }, { added: 1, id: [1], time: 1, reasons: ['a'] }]
    ])
  })
})

it('removes reason with maximum added', function () {
  store = new IndexedStore()
  return Promise.all([
    store.add({ type: '1' }, { id: [1], time: 1, reasons: ['a'] }),
    store.add({ type: '2' }, { id: [2], time: 2, reasons: ['a'] }),
    store.add({ type: '3' }, { id: [3], time: 3, reasons: ['a'] })
  ]).then(function () {
    return store.removeReason('a', { maxAdded: 2 }, nope)
  }).then(function () {
    return check(store, [
      [{ type: '3' }, { added: 3, id: [3], time: 3, reasons: ['a'] }]
    ])
  })
})

it('removes reason with minimum and maximum added', function () {
  store = new IndexedStore()
  return Promise.all([
    store.add({ type: '1' }, { id: [1], time: 1, reasons: ['a'] }),
    store.add({ type: '2' }, { id: [2], time: 2, reasons: ['a'] }),
    store.add({ type: '3' }, { id: [3], time: 3, reasons: ['a'] })
  ]).then(function () {
    return store.removeReason('a', { maxAdded: 2, minAdded: 2 }, nope)
  }).then(function () {
    return check(store, [
      [{ type: '3' }, { added: 3, id: [3], time: 3, reasons: ['a'] }],
      [{ type: '1' }, { added: 1, id: [1], time: 1, reasons: ['a'] }]
    ])
  })
})

it('removes reason with zero at maximum added', function () {
  store = new IndexedStore()
  return store.add({ }, { id: [1], time: 1, reasons: ['a'] }).then(function () {
    return store.removeReason('a', { maxAdded: 0 }, nope)
  }).then(function () {
    return check(store, [
      [{ }, { added: 1, id: [1], time: 1, reasons: ['a'] }]
    ])
  })
})

it('updates reasons cache', function () {
  store = new IndexedStore()
  return store.add({ }, { id: [1], time: 1, reasons: ['a'] }).then(function () {
    return store.changeMeta([1], { reasons: ['a', 'b', 'c'] })
  }).then(function () {
    return store.removeReason('b', { }, nope)
  }).then(function () {
    return check(store, [
      [{ }, { added: 1, id: [1], time: 1, reasons: ['a', 'c'] }]
    ])
  })
})
