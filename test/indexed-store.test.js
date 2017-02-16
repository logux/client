/* eslint-disable no-invalid-this */

var fakeIndexedDB = require('fake-indexeddb')

var IndexedStore = require('../indexed-store')

var lastStore = 0
function createStore () {
  lastStore += 1
  return new IndexedStore(lastStore)
}

var originIndexedDB = global.indexedDB
beforeEach(function () {
  global.indexedDB = fakeIndexedDB
})

afterEach(function () {
  return Promise.all([
    this.store ? this.store.destroy() : null,
    this.other ? this.other.destroy() : null
  ]).then(function () {
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

function check (store, created, added) {
  if (!added) added = created
  return all(store.get('created')).then(function (entries) {
    expect(entries).toEqual(created)
  }).then(function () {
    return all(store.get('added'))
  }).then(function (entries) {
    expect(entries).toEqual(added)
  })
}

it('allows to change DB name', function () {
  this.store = new IndexedStore('custom')
  return this.store.init().then(function (store) {
    expect(store.db.name).toEqual('custom')
    expect(store.name).toEqual('custom')
  })
})

it('is empty in the beginning', function () {
  this.store = createStore()
  var test = this
  return check(this.store, []).then(function () {
    return test.store.getLastAdded()
  }).then(function (added) {
    expect(added).toEqual(0)
    return test.store.getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual({ sent: 0, received: 0 })
  })
})

it('updates last sent value', function () {
  this.store = createStore()
  var test = this
  return this.store.setLastSynced({ sent: 1 }).then(function () {
    return test.store.getLastSynced()
  }).then(function (synced) {
    return expect(synced).toEqual({ sent: 1, received: 0 })
  }).then(function () {
    return test.store.setLastSynced({ sent: 2, received: 1 })
  }).then(function () {
    return test.store.getLastSynced()
  }).then(function (synced) {
    return expect(synced).toEqual({ sent: 2, received: 1 })
  }).then(function () {
    test.other = new IndexedStore(test.store.name)
    return test.other.getLastSynced()
  }).then(function (synced) {
    return expect(synced).toEqual({ sent: 2, received: 1 })
  })
})

it('stores entries sorted', function () {
  this.store = createStore()
  var test = this
  return Promise.all([
    this.store.add({ type: '1' }, { id: [1, 'a'], time: 1 }),
    this.store.add({ type: '2' }, { id: [1, 'c'], time: 2 }),
    this.store.add({ type: '3' }, { id: [1, 'b'], time: 2 })
  ]).then(function () {
    return check(test.store, [
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
  this.store = createStore()
  var test = this
  return this.store.add(
    { type: 'A' },
    { id: [1, 'a'], time: 1, test: 1 }
  ).then(function () {
    return check(test.store, [
      [{ type: 'A' }, { added: 1, id: [1, 'a'], time: 1, test: 1 }]
    ])
  })
})

it('ignores entries with same ID', function () {
  this.store = createStore()
  var test = this
  var id = [1, 'a', 1]
  return this.store.add({ a: 1 }, { id: id, time: 1 }).then(function (meta) {
    expect(meta).toEqual({ id: id, time: 1, added: 1 })
    return test.store.add({ a: 2 }, { id: id, time: 2 })
  }).then(function (meta) {
    expect(meta).toBeFalsy()
    return check(test.store, [
      [{ a: 1 }, { id: id, time: 1, added: 1 }]
    ])
  })
})

it('removes entries', function () {
  this.store = createStore()
  var test = this
  return Promise.all([
    this.store.add({ type: '1' }, { id: [1], time: 1 }),
    this.store.add({ type: '2' }, { id: [2], time: 2 }),
    this.store.add({ type: '3' }, { id: [3], time: 3 })
  ]).then(function () {
    return test.store.remove([2])
  }).then(function () {
    return check(test.store, [
      [{ type: '3' }, { id: [3], time: 3, added: 3 }],
      [{ type: '1' }, { id: [1], time: 1, added: 1 }]
    ])
  })
})

it('ignores unknown entry', function () {
  this.store = createStore()
  return this.store.remove([2]).then(function (removed) {
    expect(removed).toBeFalsy()
  })
})

it('returns last added', function () {
  this.store = createStore()
  var test = this
  return this.store.add({ type: 'A' }, { id: [1], time: 1 }).then(function () {
    return test.store.add({ type: 'B' }, { id: [2], time: 2 })
  }).then(function () {
    return test.store.getLastAdded()
  }).then(function (added) {
    return expect(added).toBe(2)
  }).then(function () {
    test.other = new IndexedStore(test.store.name)
    return test.other.getLastAdded()
  }).then(function (added) {
    return expect(added).toBe(2)
  })
})

it('reloads page on database update', function () {
  document.reload = jest.fn()
  this.store = createStore()
  var test = this
  return this.store.init().then(function () {
    var opening = indexedDB.open(test.store.name, 1000)
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
  this.store = createStore()
  var test = this
  return this.store.add({ type: 'A' }, { id: [1], time: 1 }).then(function () {
    return test.store.has([1])
  }).then(function (result) {
    expect(result).toBeTruthy()
    return test.store.has([2])
  }).then(function (result) {
    expect(result).toBeFalsy()
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
  var store = new IndexedStore()
  var throwed
  return store.init().catch(function (e) {
    throwed = e
  }).then(function () {
    expect(throwed).toBe(error)
  })
})
