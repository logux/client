import { cleanStores, mapTemplate } from 'nanostores'

import {
  prepareForTest,
  defineSyncMap,
  createFilter,
  emptyInTest,
  TestClient
} from '../index.js'

let client = new TestClient('10')
let User = defineSyncMap<{ name: string }>('users')

afterEach(() => {
  cleanStores(User)
})

it('prepares instances', () => {
  let user1a = prepareForTest(client, User, { id: '1', name: 'Test user' })
  let user1b = User('1', client)

  expect(user1a).toBe(user1b)
  expect(user1b.get()).toEqual({
    id: '1',
    name: 'Test user',
    isLoading: false
  })

  let user2 = User('2', client)
  expect(user2.get()).toEqual({
    id: '2',
    isLoading: true
  })
})

it('generates IDs', () => {
  let user1 = prepareForTest(client, User, { name: 'Test 1' })
  let user2 = prepareForTest(client, User, { name: 'Test 2' })

  expect(user1.get().id).toBe('users:1')
  expect(user2.get().id).toBe('users:2')
})

it('works with maps', () => {
  let Store = mapTemplate<{ id: string; name: string; role?: string }>(
    store => {
      store.setKey('role', 'default')
    }
  )

  let store1 = prepareForTest(client, Store, { name: 'Test 1' })
  let store2 = prepareForTest(client, Store, { name: 'Test 2' })

  expect(typeof store1.get().id).toBe('string')
  expect(store1.get().id).not.toEqual(store2.get().id)
  expect(store1.get()).toEqual({
    id: store1.get().id,
    name: 'Test 1',
    role: 'default'
  })
})

it('works with filters', () => {
  prepareForTest(client, User, { name: 'Test 1' })
  prepareForTest(client, User, { name: 'Test 2' })

  let users1 = createFilter(client, User)
  users1.listen(() => {})

  expect(users1.get().isLoading).toBe(false)
  expect(users1.get().list).toEqual([
    { id: 'users:1', isLoading: false, name: 'Test 1' },
    { id: 'users:2', isLoading: false, name: 'Test 2' }
  ])

  cleanStores(User)
  let users2 = createFilter(client, User)
  expect(users2.get().isLoading).toBe(true)
})

it('marks empty', () => {
  emptyInTest(User)

  let users1 = createFilter(client, User)
  users1.listen(() => {})

  expect(users1.get().isLoading).toBe(false)
  expect(users1.get().list).toEqual([])
})
