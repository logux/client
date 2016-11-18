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

it('adds events', function () {
  var store = new LocalStore()
  store.add([{ type: 'b' }, { created: [1], added: 1 }])
  store.add([{ type: 'a' }, { created: [0], added: 2 }])
  expect(store.memory.created).toEqual([
    [{ type: 'b' }, { created: [1], added: 1 }],
    [{ type: 'a' }, { created: [0], added: 2 }]
  ])
  expect(store.memory.added).toEqual([
    [{ type: 'a' }, { created: [0], added: 2 }],
    [{ type: 'b' }, { created: [1], added: 1 }]
  ])
})

it('uses localStorage', function () {
  var store1 = new LocalStore()
  store1.add([{ type: 'b' }, { created: [1], added: 1 }])
  store1.add([{ type: 'a' }, { created: [0], added: 2 }])

  store1.add([{ type: 'c' }, { created: [2], added: 3 }])
  store1.remove([2])

  var store2 = new LocalStore()
  expect(store2.memory.created).toEqual([
    [{ type: 'b' }, { created: [1], added: 1 }],
    [{ type: 'a' }, { created: [0], added: 2 }]
  ])
  expect(store2.memory.added).toEqual([
    [{ type: 'a' }, { created: [0], added: 2 }],
    [{ type: 'b' }, { created: [1], added: 1 }]
  ])
})

it('uses prefix', function () {
  var store = new LocalStore('app')
  store.add([{ type: 'b' }, { created: [1], added: 1 }])
  expect(localStorage.length).toBe(2)
  expect(localStorage.key(0)).toEqual('appLog')
  expect(localStorage.key(1)).toEqual('appLogVersion')
})

it('has default prefix', function () {
  var store = new LocalStore()
  store.add([{ type: 'b' }, { created: [1], added: 1 }])
  expect(localStorage.length).toBe(2)
  expect(localStorage.key(0)).toEqual('loguxLog')
  expect(localStorage.key(1)).toEqual('loguxLogVersion')
})

it('checks log format version', function () {
  var store1 = new LocalStore()
  store1.add([{ type: 'b' }, { created: [1], added: 1 }])
  store1.add([{ type: 'a' }, { created: [0], added: 2 }])
  localStorage.setItem('loguxLogVersion', 'test')

  var store2 = new LocalStore()
  expect(store2.memory.created).toEqual([])

  expect(console.error).toBeCalledWith(
    'Logux log in localStorage is in outdated format. Log was ignored.')
})

it('works on broken JSON in localStorage', function () {
  localStorage.setItem('loguxLog', '[')
  localStorage.setItem('loguxLogVersion', '0')

  var store = new LocalStore()
  expect(store.memory.created).toEqual([])

  expect(localStorage.length).toBe(0)
  expect(console.error).toBeCalledWith(
    'Logux log in localStorage is broken. Log was cleaned.')
})

it('works without localStorage support', function () {
  global.localStorage = undefined

  var store = new LocalStore()
  store.add([{ type: 'b' }, { created: [1], added: 1 }])
  store.add([{ type: 'a' }, { created: [0], added: 2 }])
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
  store.add([{ type: 'b' }, { created: [1], added: 1 }])

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
  store.add([{ type: 'b' }, { created: [1], added: 1 }])

  expect(store.memory.created.length).toBe(1)
  expect(console.error).toBeCalled()
})

it('throws other errors during localStorage write', function () {
  localStorage.itemInsertionCallback = function () {
    throw new Error('Test')
  }

  var store = new LocalStore()
  expect(function () {
    store.add([{ type: 'b' }, { created: [1], added: 1 }])
  }).toThrowError('Test')
})
