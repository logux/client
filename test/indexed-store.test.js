/* eslint-disable no-invalid-this */

let { eachStoreCheck } = require('@logux/core')
let fakeIndexedDB = require('fake-indexeddb')

let IndexedStore = require('../indexed-store')

let originIndexedDB = global.indexedDB
beforeEach(() => {
  global.indexedDB = fakeIndexedDB
})

function promisify (request) {
  return new Promise((resolve, reject) => {
    request.onerror = e => {
      reject(e.target.error)
    }
    request.onsuccess = e => {
      resolve(e.target.result)
    }
  })
}

async function all (request, list) {
  if (!list) list = []
  let page = await request
  list = list.concat(page.entries)
  if (page.next) {
    return all(page.next(), list)
  } else {
    return list
  }
}

async function check (indexed, created, added) {
  if (!added) added = created
  let entriesCreated = await all(indexed.get({ order: 'created' }))
  expect(entriesCreated).toEqual(created)
  let entriesAdded = await all(indexed.get({ order: 'added' }))
  expect(entriesAdded).toEqual(added)
}

let store, other

afterEach(async () => {
  if (store) {
    await store.clean()
    store = undefined
  }
  if (other) {
    await other.clean()
    other = undefined
  }
  global.indexedDB = originIndexedDB
  delete global.document.reload
})

eachStoreCheck((desc, creator) => {
  it(`${ desc }`, creator(() => {
    store = new IndexedStore()
    return store
  }))
})

it('use logux as default name', async () => {
  store = new IndexedStore()
  await store.init()
  expect(store.db.name).toEqual('logux')
  expect(store.name).toEqual('logux')
})

it('allows to change DB name', async () => {
  store = new IndexedStore('custom')
  await store.init()
  expect(store.db.name).toEqual('custom')
  expect(store.name).toEqual('custom')
})

it('reloads page on database update', async () => {
  document.reload = () => true
  jest.spyOn(document, 'reload')
  store = new IndexedStore()
  await store.init()
  let opening = indexedDB.open(store.name, 1000)
  await new Promise((resolve, reject) => {
    opening.onsuccess = e => {
      e.target.result.close()
      resolve()
    }
    opening.onerror = e => {
      reject(e.target.error)
    }
  })
  expect(document.reload).toHaveBeenCalledTimes(1)
})

it('throws a errors', async () => {
  let error = new Error('test')
  global.indexedDB = {
    open () {
      let request = { }
      setTimeout(() => {
        request.onerror({ target: { error } })
      }, 1)
      return request
    }
  }
  let broken = new IndexedStore()
  let throwed
  try {
    await broken.init()
  } catch (e) {
    throwed = e
  }
  expect(throwed).toBe(error)
})

it('works with broken lastSynced', async () => {
  store = new IndexedStore()
  await store.init()
  await promisify(store.os('extra', 'write').delete('lastSynced'))
  let synced = await store.getLastSynced()
  expect(synced).toEqual({ sent: 0, received: 0 })
  await store.setLastSynced({ sent: 1, received: 1 })
})

it('updates reasons cache', async () => {
  store = new IndexedStore()
  await store.add({ }, { id: '1', time: 1, reasons: ['a'] })
  await store.changeMeta('1', { reasons: ['a', 'b', 'c'] })
  await store.removeReason('b', { }, () => { })
  await check(store, [
    [{ }, { added: 1, id: '1', time: 1, reasons: ['a', 'c'] }]
  ])
})
