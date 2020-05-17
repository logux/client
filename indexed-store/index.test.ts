import { eachStoreCheck, Action, Meta, Page } from '@logux/core'

import { IndexedStore } from '..'
import fakeIndexedDB = require('fake-indexeddb')

type Entry = [Action, Meta]

declare global {
  interface Document {
    reload: () => void
  }
  namespace NodeJS {
    interface Global {
      indexedDB: IDBFactory
    }
  }
}

let originIndexedDB = global.indexedDB
beforeEach(() => {
  global.indexedDB = fakeIndexedDB
})

function privateMethods (obj: object): any {
  return obj
}

function promisify (request: IDBRequest) {
  return new Promise((resolve, reject) => {
    request.onerror = (e: any) => {
      reject(e.target.error)
    }
    request.onsuccess = resolve
  })
}

async function all (
  request: Promise<Page>,
  list: Entry[] = []
): Promise<Entry[]> {
  let page = await request
  list = list.concat(page.entries)
  if (typeof page.next !== 'undefined') {
    return all(page.next(), list)
  } else {
    return list
  }
}

async function check (db: IndexedStore, created: Entry[], added = created) {
  let entriesCreated = await all(db.get({ order: 'created' }))
  expect(entriesCreated).toEqual(created)
  let entriesAdded = await all(db.get({ order: 'added' }))
  expect(entriesAdded).toEqual(added)
}

let store: IndexedStore | undefined

afterEach(async () => {
  await store?.clean()
  store = undefined
  global.indexedDB = originIndexedDB
  delete document.reload
})

eachStoreCheck((desc, creator) => {
  it(
    `${desc}`,
    creator(() => {
      store = new IndexedStore()
      return store
    })
  )
})

it('use logux as default name', async () => {
  store = new IndexedStore()
  await privateMethods(store).init()
  expect(privateMethods(store).db.name).toEqual('logux')
  expect(store.name).toEqual('logux')
})

it('allows to change DB name', async () => {
  store = new IndexedStore('custom')
  await privateMethods(store).init()
  expect(privateMethods(store).db.name).toEqual('custom')
  expect(store.name).toEqual('custom')
})

it('reloads page on database update', async () => {
  document.reload = () => true
  jest.spyOn(document, 'reload')
  store = new IndexedStore()
  await privateMethods(store).init()
  let opening = indexedDB.open(store.name, 1000)
  await new Promise((resolve, reject) => {
    opening.onsuccess = (e: any) => {
      e.target.result.close()
      resolve()
    }
    opening.onerror = (e: any) => {
      reject(e.target.error)
    }
  })
  expect(document.reload).toHaveBeenCalledTimes(1)
})

it('throws init error', async () => {
  let error = new Error('test')
  global.indexedDB = {
    ...indexedDB,
    open: () => {
      let request: any = {}
      setTimeout(() => {
        request.onerror({ target: { error } })
      }, 1)
      return request
    }
  }
  let broken = new IndexedStore()
  let throwed
  try {
    await privateMethods(broken).init()
  } catch (e) {
    throwed = e
  }
  expect(throwed).toBe(error)
})

it('works with broken lastSynced', async () => {
  store = new IndexedStore()
  await privateMethods(store).init()
  await promisify(
    privateMethods(store)
      .os('extra', 'write')
      .delete('lastSynced')
  )
  let synced = await store.getLastSynced()
  expect(synced).toEqual({ sent: 0, received: 0 })
  await store.setLastSynced({ sent: 1, received: 1 })
})

it('updates reasons cache', async () => {
  store = new IndexedStore()
  await store.add({ type: 'A' }, { added: 1, id: '1', time: 1, reasons: ['a'] })
  await store.changeMeta('1', { reasons: ['a', 'b', 'c'] })
  await store.removeReason('b', {}, () => {})
  await check(store, [
    [{ type: 'A' }, { added: 1, id: '1', time: 1, reasons: ['a', 'c'] }]
  ])
})
