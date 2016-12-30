require('mock-local-storage')

var LocalStore = require('../local-store')

var originError = console.error
var originStorage = localStorage
beforeEach(function () {
  console.error = jest.fn()
})

afterEach(function () {
  console.error = originError
  global.localStorage = originStorage
  localStorage.clear()
  localStorage.itemInsertionCallback = null
})

function check (store, type, entries) {
  return store.get(type).then(function (page) {
    expect(page.entries).toEqual(entries)
    expect(page.next).toBeUndefined()
  })
}

it('has synced values set to 0', function () {
  var store = new LocalStore('logux')
  return store.getLastSynced().then(function (synced) {
    expect(synced).toEqual({ sent: 0, received: 0 })
  })
})

it('updates latest sent value', function () {
  var store = new LocalStore('logux')
  return store.setLastSynced({ sent: 1 }).then(function () {
    return store.getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual({ sent: 1, received: 0 })
  })
})

it('updates both synced values', function () {
  var store = new LocalStore('logux')
  var value = { received: 1, sent: 2 }
  return store.setLastSynced(value).then(function () {
    return store.getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual(value)
  })
})

it('adds events', function () {
  var store = new LocalStore('logux')
  store.add({ a: 1 }, { id: [1], time: 1, added: 1 })
  store.add({ a: 2 }, { id: [0], time: 2, added: 2 })
  return check(store.memory, 'created', [
    [{ a: 2 }, { id: [0], time: 2, added: 2 }],
    [{ a: 1 }, { id: [1], time: 1, added: 1 }]
  ])
})

it('gets events', function () {
  var store = new LocalStore('logux')
  store.add({ a: 1 }, { id: [1], time: 1, added: 1 })
  return store.get().then(function (data) {
    expect(data).toEqual({
      entries: [[{ a: 1 }, { id: [1], time: 1, added: 1 }]]
    })
  })
})

it('gets last added', function () {
  var store = new LocalStore('logux')
  store.getLastAdded().then(function (added) {
    expect(added).toBe(added)
    return store.add({ type: 'a' }, { id: [1] })
  }).then(function () {
    return store.getLastAdded()
  }).then(function (added) {
    expect(added).toBe(1)
  })
})

it('uses localStorage', function () {
  var store1 = new LocalStore('logux')
  store1.add({ a: 1 }, { id: [1], time: 1 })
  store1.add({ a: 2 }, { id: [0], time: 2 })

  store1.add({ a: 3 }, { id: [2], time: 3 })
  store1.remove([2])

  var store2 = new LocalStore('logux')
  return check(store2.memory, 'created', [
    [{ a: 2 }, { id: [0], time: 2, added: 2 }],
    [{ a: 1 }, { id: [1], time: 1, added: 1 }]
  ])
})

it('uses prefix', function () {
  var store = new LocalStore('app')
  store.add({ a: 1 }, { id: [1], time: 1 })
  expect(localStorage.length).toBe(2)
  expect(localStorage.key(0)).toEqual('appLog')
  expect(localStorage.key(1)).toEqual('appLogVersion')
})

it('checks log format version', function () {
  var store1 = new LocalStore('logux')
  store1.add({ a: 1 }, { id: [1], time: 1 })
  store1.add({ a: 2 }, { id: [0], time: 2 })
  localStorage.setItem('loguxLogVersion', 'test')

  var store2 = new LocalStore('logux')
  expect(store2.memory.created).toEqual([])

  expect(console.error).toBeCalledWith(
    'Logux log in localStorage is in outdated format. Log was ignored.')
})

it('works on broken JSON in localStorage', function () {
  localStorage.setItem('loguxLog', '[')
  localStorage.setItem('loguxLogVersion', '0')

  var store = new LocalStore('logux')
  expect(store.memory.created).toEqual([])

  expect(localStorage.length).toBe(0)
  expect(console.error).toBeCalledWith(
    'Logux log in localStorage is broken. Log was cleaned.')
})

it('works without localStorage support', function () {
  global.localStorage = undefined

  var store = new LocalStore('logux')
  store.add({ a: 1 }, { id: [1], time: 1 })
  store.add({ a: 2 }, { id: [0], time: 2 })
  expect(store.memory.created.length).toBe(2)

  expect(console.error).toBeCalledWith(
    'Logux didn’t find localStorage. Memory-only store was used.')
})

it('shows warning on quota limit', function () {
  localStorage.itemInsertionCallback = function () {
    var err = new Error('Mock localStorage quota exceeded')
    err.code = DOMException.QUOTA_EXCEEDED_ERR
    throw err
  }

  var store = new LocalStore()
  store.add({ a: 1 }, { id: [1], time: 1 })

  expect(store.memory.created.length).toBe(1)
  expect(console.error).toBeCalled()
})

it('shows warning on Mozilla quota limit', function () {
  localStorage.itemInsertionCallback = function () {
    var err = new Error('Mock localStorage quota exceeded')
    err.name = 'NS_ERROR_DOM_QUOTA_REACHED'
    err.code = 1014
    throw err
  }

  var store = new LocalStore()
  store.add({ a: 1 }, { id: [1], time: 1 })

  expect(store.memory.created.length).toBe(1)
  expect(console.error).toBeCalled()
})

it('throws other errors during localStorage write', function () {
  localStorage.itemInsertionCallback = function () {
    throw new Error('Test')
  }

  var store = new LocalStore()
  expect(function () {
    store.add({ a: 1 }, { id: [1], time: 1 })
  }).toThrowError('Test')
})
