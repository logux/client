var fakeIndexedDB = require('fake-indexeddb')

window.indexedDB = fakeIndexedDB

var IndexedDBStore = require('../indexeddb-store')

var store
var testDB

beforeEach(function () {
  store = new IndexedDBStore()
  return store.init().then(function () {
    testDB = store.db
  })
})

afterEach(function () {
  testDB.close()
  fakeIndexedDB.deleteDatabase('loguxLog')
})

function check (store, type, entries) {
  return store.get(type).then(function (page) {
    expect(page.entries).toEqual(entries)
    expect(page.next).toBeUndefined()
  })
}

function checkBoth (store, entries) {
  return Promise.all([
    check(store, 'created', entries),
    check(store, 'added', entries)
  ])
}

it('can be created store with custom db name', function () {
  var store2 = new IndexedDBStore()
  return store2.init('customName').then(function () {
    store2.db.close()
    fakeIndexedDB.deleteDatabase('customName')
    return expect(store2.dbName).toEqual('customName')
  })
})

it('is empty in the beginning', function () {
  return check(store, 'created', [])
})

it('has synced values set to 0', function () {
  return store.getLastSynced().then(function (synced) {
    expect(synced).toEqual({ sent: 0, received: 0 })
  })
})

it('updates latest sent value', function () {
  return store.setLastSynced({ sent: 1 }).then(function () {
    return store.getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual({ sent: 1, received: 0 })
  })
})

it('updates both synced values', function () {
  var value = { received: 1, sent: 2 }
  return store.setLastSynced(value).then(function () {
    return store.getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual(value)
  })
})

it('adds first event', function () {
  return store.add({ a: 1 }, { id: [1], time: 1 }).then(function () {
    return check(store, 'created', [[{ a: 1 }, { id: [1], time: 1, added: 1 }]])
  })
})

it('stores entries sorted', function () {
  store.add({ a: 1 }, { id: [1, 'a'], time: 3 })
  store.add({ a: 2 }, { id: [1, 'b'], time: 2 })
  store.add({ a: 3 }, { id: [1, 'c'], time: 5 })
  store.add({ a: 4 }, { id: [1, 'd'], time: 1 })
  store.add({ a: 5 }, { id: [1, 'e'], time: 4 })
  return check(store, 'created', [
    [{ a: 3 }, { id: [1, 'c'], time: 5, added: 3 }],
    [{ a: 5 }, { id: [1, 'e'], time: 4, added: 5 }],
    [{ a: 1 }, { id: [1, 'a'], time: 3, added: 1 }],
    [{ a: 2 }, { id: [1, 'b'], time: 2, added: 2 }],
    [{ a: 4 }, { id: [1, 'd'], time: 1, added: 4 }]
  ]).then(function () {
    return check(store, 'added', [
      [{ a: 5 }, { id: [1, 'e'], time: 4, added: 5 }],
      [{ a: 4 }, { id: [1, 'd'], time: 1, added: 4 }],
      [{ a: 3 }, { id: [1, 'c'], time: 5, added: 3 }],
      [{ a: 2 }, { id: [1, 'b'], time: 2, added: 2 }],
      [{ a: 1 }, { id: [1, 'a'], time: 3, added: 1 }]
    ])
  })
})

it('supports time array in created', function () {
  store.add({ }, { id: [1, 1, 1], time: 1 })
  store.add({ }, { id: [2, 1, 1], time: 2 })
  store.add({ }, { id: [2, 1, 3], time: 2 })
  store.add({ }, { id: [2, 2, 1], time: 2 })
  store.add({ }, { id: [2, 1, 2], time: 2 })
  store.add({ }, { id: [2, 3, 1], time: 2 })
  store.add({ }, { id: [3, 1, 1], time: 3 })
  return check(store, 'created', [
    [{ }, { id: [3, 1, 1], time: 3, added: 7 }],
    [{ }, { id: [2, 3, 1], time: 2, added: 6 }],
    [{ }, { id: [2, 2, 1], time: 2, added: 4 }],
    [{ }, { id: [2, 1, 3], time: 2, added: 3 }],
    [{ }, { id: [2, 1, 2], time: 2, added: 5 }],
    [{ }, { id: [2, 1, 1], time: 2, added: 2 }],
    [{ }, { id: [1, 1, 1], time: 1, added: 1 }]
  ])
})

it('ignores entries with same ID', function () {
  return store.add({ a: 1 }, { id: [1, 'node', 1], time: 1 })
    .then(function (result1) {
      expect(result1).toEqual(1)
      return store.add({ a: 2 }, { id: [1, 'node', 1], time: 2 })
    }).then(function (result2) {
      expect(result2).toBeFalsy()
      return checkBoth(store, [
        [{ a: 1 }, { id: [1, 'node', 1], time: 1, added: 1 }]
      ])
    })
})

it('removes entries', function () {
  store.add({ }, { id: [1], time: 1 })
  store.add({ }, { id: [2], time: 2 })
  store.add({ }, { id: [3], time: 3 })
  store.add({ }, { id: [4], time: 4 })
  store.remove([2])
  return checkBoth(store, [
    [{ }, { id: [4], time: 4, added: 4 }],
    [{ }, { id: [3], time: 3, added: 3 }],
    [{ }, { id: [1], time: 1, added: 1 }]
  ])
})

it('ignores unknown entry', function () {
  store.add({ }, { id: [1], time: 1, added: 1 })
  store.remove([2])
  return check(store, 'created', [
    [{ }, { id: [1], time: 1, added: 1 }]
  ])
})

it('returns current entries state', function () {
  var promise1 = check(store, 'created', [])
  var promise2 = store.add({ type: 'a' }, { id: [1] })
  return Promise.all([promise1, promise2])
})

it('returns latest added', function () {
  store.getLastAdded().then(function (added) {
    expect(added).toBe(added)
    return store.add({ type: 'a' }, { id: [1] })
  }).then(function () {
    return store.getLastAdded()
  }).then(function (added) {
    expect(added).toBe(1)
  })
})

it('initialized db resolved without reopening', function () {
  return store.init().then(function (sameStore) {
    return expect(sameStore.db).toEqual(store.db)
  })
})

it('get returns page by size', function () {
  store.add({ type: 'test' }, { id: [1], time: 1 })
  store.add({ type: 'test' }, { id: [2], time: 2 })
  store.add({ type: 'test' }, { id: [3], time: 3 })
  store.add({ type: 'test' }, { id: [4], time: 4 })
  store.add({ type: 'test' }, { id: [5], time: 5 })
  return store.get('created', 4).then(function (res) {
    return expect(res.entries.length).toEqual(4)
  })
})

