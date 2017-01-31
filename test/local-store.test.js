require('mock-local-storage')

var LocalStore = require('../local-store')

var originError = console.error
var originStorage = localStorage
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

it('stores synced values', function () {
  var store = new LocalStore('logux')
  return store.getLastSynced().then(function (synced) {
    expect(synced).toEqual({ sent: 0, received: 0 })
    return store.setLastSynced({ sent: 1 })
  }).then(function () {
    return store.getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual({ sent: 1, received: 0 })
    return store.setLastSynced({ sent: 2, received: 1 })
  }).then(function () {
    return store.getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual({ sent: 2, received: 1 })
    return (new LocalStore('logux')).getLastSynced()
  }).then(function (synced) {
    expect(synced).toEqual({ sent: 2, received: 1 })
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
  return store.getLastAdded().then(function (added) {
    expect(added).toBe(0)
    return Promise.all([
      store.add({ type: 'a' }, { id: [1] }),
      store.add({ type: 'b' }, { id: [2] })
    ])
  }).then(function () {
    return store.getLastAdded()
  }).then(function (added) {
    expect(added).toBe(2)
    return (new LocalStore('logux')).getLastAdded()
  }).then(function (added) {
    expect(added).toBe(2)
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
  expect(localStorage.length).toBe(4)
  expect(localStorage.key(0)).toEqual('app')
  expect(localStorage.key(1)).toEqual('appVersion')
  expect(localStorage.key(2)).toEqual('appLastSent')
  expect(localStorage.key(3)).toEqual('appLastReceived')
})

it('checks log format version', function () {
  console.error = jest.fn()

  var store1 = new LocalStore('logux')
  store1.add({ a: 1 }, { id: [1], time: 1 })
  store1.add({ a: 2 }, { id: [0], time: 2 })
  localStorage.setItem('loguxVersion', 'test')

  var store2 = new LocalStore('logux')
  expect(store2.memory.created).toEqual([])

  expect(console.error).toBeCalledWith(
    'Logux log in localStorage is in outdated format. Log was ignored.')
})

it('works on broken JSON in localStorage', function () {
  console.error = jest.fn()

  localStorage.setItem('logux', '[')
  localStorage.setItem('loguxVersion', '1')

  var store = new LocalStore('logux')
  expect(store.memory.created).toEqual([])

  expect(localStorage.length).toBe(0)
  expect(console.error).toBeCalledWith(
    'Logux log in localStorage is broken. Log was cleaned.')
})

it('works without localStorage support', function () {
  console.error = jest.fn()
  global.localStorage = undefined

  var store = new LocalStore('logux')
  store.add({ a: 1 }, { id: [1], time: 1 })
  store.add({ a: 2 }, { id: [0], time: 2 })
  expect(store.memory.created.length).toBe(2)

  expect(console.error).toBeCalledWith(
    'Logux didn’t find localStorage. Memory-only store was used.')
})

it('shows warning on quota limit', function () {
  console.error = jest.fn()

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
  console.error = jest.fn()

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
