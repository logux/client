import 'fake-indexeddb/auto'

import {
  type Action,
  eachStoreCheck,
  type LogPage,
  type Meta
} from '@logux/core'
import { spyOn } from 'nanospy'
import { afterEach, expect, it } from 'vitest'

import { IndexedStore } from '../index.js'

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

function privateMethods(obj: object): any {
  return obj
}

function promisify(request: IDBRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    request.onerror = (e: any) => {
      reject(e.target.error)
    }
    request.onsuccess = resolve
  })
}

async function all(
  request: Promise<LogPage>,
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

async function check(
  db: IndexedStore,
  created: Entry[],
  added = created
): Promise<void> {
  let entriesCreated = await all(db.get({ order: 'created' }))
  expect(entriesCreated).toEqual(created)
  let entriesAdded = await all(db.get({ order: 'added' }))
  expect(entriesAdded).toEqual(added)
}

let store: IndexedStore | undefined

afterEach(async () => {
  await store?.clean()
  store = undefined
  // @ts-expect-error
  delete document.reload
})

eachStoreCheck((desc, creator) => {
  it(
    desc,
    creator(() => {
      store = new IndexedStore()
      return store
    })
  )
})

it('use logux as default name', async () => {
  store = new IndexedStore()
  await privateMethods(store).init()
  expect(privateMethods(store).db.name).toBe('logux')
  expect(store.name).toBe('logux')
})

it('allows to change DB name', async () => {
  store = new IndexedStore('custom')
  await privateMethods(store).init()
  expect(privateMethods(store).db.name).toBe('custom')
  expect(store.name).toBe('custom')
})

it('reloads page on database update', async () => {
  document.reload = () => true
  let reload = spyOn(document, 'reload')
  store = new IndexedStore()
  await privateMethods(store).init()
  let opening = indexedDB.open(store.name, 1000)
  await new Promise<void>((resolve, reject) => {
    opening.onsuccess = (e: any) => {
      e.target.result.close()
      resolve()
    }
    opening.onerror = (e: any) => {
      reject(e.target.error)
    }
  })
  expect(reload.callCount).toEqual(1)
})

it('works with broken lastSynced', async () => {
  store = new IndexedStore()
  await privateMethods(store).init()
  await promisify(
    privateMethods(store).os('extra', 'write').delete('lastSynced')
  )
  let synced = await store.getLastSynced()
  expect(synced).toEqual({ received: 0, sent: 0 })
  await store.setLastSynced({ received: 1, sent: 1 })
})

it('updates reasons cache', async () => {
  store = new IndexedStore()
  await store.add({ type: 'A' }, { added: 1, id: '1', reasons: ['a'], time: 1 })
  await store.changeMeta('1', { reasons: ['a', 'b', 'b', 'c'] })
  await store.removeReason('b', {}, () => {})
  await check(store, [
    [{ type: 'A' }, { added: 1, id: '1', reasons: ['a', 'c'], time: 1 }]
  ])
})
