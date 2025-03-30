import { delay } from 'nanodelay'
import { allTasks, cleanStores } from 'nanostores'
import { afterEach, expect, it } from 'vitest'

import {
  buildNewSyncMap,
  changeSyncMap,
  changeSyncMapById,
  createFilter,
  createSyncMap,
  deleteSyncMapById,
  ensureLoaded,
  loadValue,
  syncMapTemplate,
  TestClient
} from '../index.js'
import type { FilterStore } from '../index.js'

let Post = syncMapTemplate<{
  authorId: string
  projectId: string
  title: string
}>('posts')

let LocalPost = syncMapTemplate<{
  authorId?: string
  category?: string
  projectId: string
  title: string
}>('local', {
  offline: true,
  remote: false
})

let CachedPost = syncMapTemplate<{
  projectId: string
  title: string
}>('cached', {
  offline: true
})

let User = syncMapTemplate<{ name: string; projectId: string }>('users')

afterEach(() => {
  cleanStores(Post, LocalPost, CachedPost, User)
})

function cachedIds(Template: any): string[] {
  return Object.keys(Template.cache)
}

function getSize(filterStore: FilterStore): number {
  return ensureLoaded(filterStore.get()).stores.size
}

it('caches filters', () => {
  let client = new TestClient('10')
  let filter1 = createFilter(client, Post, { projectId: '10' })
  let filter2 = createFilter(client, Post, { projectId: '10' })
  let filter3 = createFilter(client, Post, { projectId: '10' }, {})
  let filter4 = createFilter(
    client,
    Post,
    { projectId: '10' },
    { listChangesOnly: true }
  )
  let filter5 = createFilter(client, Post, { projectId: '20' })
  let filter6 = createFilter(client, User, { projectId: '20' })

  expect(filter1).toBe(filter2)
  expect(filter1).toBe(filter3)
  expect(filter1).not.toBe(filter4)
  expect(filter1).not.toBe(filter5)
  expect(filter1).not.toBe(filter6)

  filter1.listen(() => {})
  filter2.listen(() => {})
  filter3.listen(() => {})
  filter4.listen(() => {})
  filter5.listen(() => {})
  filter6.listen(() => {})
  expect(client.log.actions()).toHaveLength(4)
})

it('looks for already loaded stores', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post1 = Post('1', client)
  let post2 = Post('2', client)
  let post3 = Post('3', client)
  let post4 = Post('4', client)

  post1.listen(() => {})
  post2.listen(() => {})
  post3.listen(() => {})
  post4.listen(() => {})

  await changeSyncMap(post1, { authorId: '10', projectId: '100' })
  await changeSyncMap(post2, { authorId: '10', projectId: '100' })
  await changeSyncMap(post3, { authorId: '10', projectId: '200' })
  await changeSyncMap(post4, { authorId: '11', projectId: '100' })

  let posts = createFilter(client, Post, {
    authorId: '10',
    projectId: '100'
  })

  expect(posts.get().isLoading).toBe(true)
  expect((posts.get() as any).stores).toEqual(
    new Map([
      ['1', post1],
      ['2', post2]
    ])
  )
  expect((posts.get() as any).list).toEqual([
    { authorId: '10', id: '1', isLoading: false, projectId: '100' },
    { authorId: '10', id: '2', isLoading: false, projectId: '100' }
  ])
})

it('subscribes to channels for remote stores', async () => {
  let client = new TestClient('10')
  client.log.keepActions()
  await client.connect()

  let resolved = false
  let posts = createFilter(client, Post, { projectId: '1' })

  await delay(1)
  expect(client.log.actions()).toHaveLength(0)

  let unbind: (() => void) | undefined
  await client.server.freezeProcessing(async () => {
    unbind = posts.listen(() => {})
    posts.loading.then(() => {
      resolved = true
    })
    await delay(1)
    expect(client.log.actions()).toEqual([
      { channel: 'posts', filter: { projectId: '1' }, type: 'logux/subscribe' }
    ])
    expect(resolved).toBe(false)
    expect(posts.get().isLoading).toBe(true)
  })
  expect(resolved).toBe(true)
  expect(posts.get().isLoading).toBe(false)

  expect(
    await client.sent(async () => {
      unbind?.()
      await delay(1020)
    })
  ).toEqual([
    { channel: 'posts', filter: { projectId: '1' }, type: 'logux/unsubscribe' }
  ])

  expect(
    await client.sent(async () => {
      let cached = createFilter(client, CachedPost, { projectId: '1' })
      let unbindCached = cached.listen(() => {})
      unbindCached()
      await delay(1020)
    })
  ).toEqual([
    { channel: 'cached', filter: { projectId: '1' }, type: 'logux/subscribe' },
    { channel: 'cached', filter: { projectId: '1' }, type: 'logux/unsubscribe' }
  ])

  expect(
    await client.sent(() => {
      let local = createFilter(client, LocalPost, { projectId: '1' })
      let unbindLocal = local.listen(() => {})
      unbindLocal()
    })
  ).toEqual([])
})

it('does not subscribe if server did it for client', async () => {
  let client = new TestClient('10')
  await client.connect()
  client.log.keepActions()

  let posts = createFilter(client, Post)
  let unbind = posts.listen(() => {})
  await allTasks()

  await client.server.sendAll({ channel: 'posts/1', type: 'logux/subscribed' })
  await client.server.sendAll({ channel: 'posts/2', type: 'logux/subscribed' })
  await client.server.sendAll({
    fields: { title: 'A' },
    id: '1',
    type: 'posts/created'
  })
  await client.server.sendAll({
    fields: { title: 'B' },
    id: '2',
    type: 'posts/changed'
  })
  await allTasks()
  expect(ensureLoaded(posts.get()).list).toEqual([
    { id: '1', isLoading: false, title: 'A' },
    { id: '2', isLoading: false, title: 'B' }
  ])

  unbind()
  await delay(2020)
  expect(client.log.actions()).toEqual([
    { channel: 'posts', filter: {}, type: 'logux/subscribe' },
    { id: '1 10:2:2 0', type: 'logux/processed' },
    { channel: 'posts/1', type: 'logux/subscribed' },
    { channel: 'posts/2', type: 'logux/subscribed' },
    { fields: { title: 'A' }, id: '1', type: 'posts/created' },
    { fields: { title: 'B' }, id: '2', type: 'posts/changed' },
    { channel: 'posts', filter: {}, type: 'logux/unsubscribe' },
    { id: '7 10:2:2 0', type: 'logux/processed' },
    { channel: 'posts/1', type: 'logux/unsubscribe' },
    { channel: 'posts/2', type: 'logux/unsubscribe' },
    { id: '9 10:2:2 0', type: 'logux/processed' },
    { id: '10 10:2:2 0', type: 'logux/processed' }
  ])
})

it('loads store from the log for offline stores', async () => {
  let client = new TestClient('10')
  client.log.keepActions()
  await createSyncMap(client, LocalPost, {
    id: '1',
    projectId: '10',
    title: 'Post 1a'
  })
  await deleteSyncMapById(client, LocalPost, '1')

  await createSyncMap(client, LocalPost, {
    id: '1',
    projectId: '20',
    title: 'Post 1b'
  })

  await createSyncMap(client, LocalPost, {
    id: '2',
    projectId: '20',
    title: 'Post 2'
  })
  await changeSyncMapById(client, LocalPost, '2', 'projectId', '10')
  await changeSyncMapById(client, LocalPost, '2', 'projectId', '30')

  await createSyncMap(client, LocalPost, {
    id: '3',
    projectId: '10',
    title: 'Post 3'
  })
  await deleteSyncMapById(client, LocalPost, '3')

  await createSyncMap(client, LocalPost, {
    id: '4',
    projectId: '20',
    title: 'Post 4'
  })
  await changeSyncMapById(client, LocalPost, '4', 'projectId', '10')

  await createSyncMap(client, LocalPost, {
    id: '5',
    projectId: '10',
    title: 'Post 5'
  })

  cleanStores(LocalPost)

  let posts = createFilter(client, LocalPost, { projectId: '10' })
  posts.listen(() => {})
  expect(posts.get().isLoading).toBe(true)
  await posts.loading
  expect(posts.get().isLoading).toBe(false)
  expect(Array.from(ensureLoaded(posts.get()).stores.keys()).sort()).toEqual([
    '4',
    '5'
  ])
  await delay(1020)
  expect(cachedIds(LocalPost)).toEqual(['4', '5'])
})

it('does not send since when subscribing to remote stores', async () => {
  let client = new TestClient('10')
  client.log.keepActions()
  await client.connect()

  // when creating a filter without any cached log
  let filter1 = createFilter(client, Post, {})
  await client.server.freezeProcessing(async () => {
    filter1.listen(() => {})
    await delay(1)
  })
  await allTasks()

  expect(client.log.actions()).toEqual([
    { channel: 'posts', filter: {}, type: 'logux/subscribe' },
    { id: '1 10:2:2 0', type: 'logux/processed' }
  ])

  await createSyncMap(client, Post, {
    authorId: '10',
    id: 'ID',
    projectId: '10',
    title: 'Cached'
  })

  // when creating filter with a matching action in cache
  let filter2 = createFilter(client, Post, { projectId: '10' })
  await client.server.freezeProcessing(async () => {
    filter2.listen(() => {})
    await delay(1)
  })
  await allTasks()

  expect(client.log.actions()).toEqual([
    // first subscribe
    { channel: 'posts', filter: {}, type: 'logux/subscribe' },
    { id: '1 10:2:2 0', type: 'logux/processed' },

    // create item
    {
      fields: { authorId: '10', projectId: '10', title: 'Cached' },
      id: 'ID',
      type: 'posts/create'
    },
    { channel: 'posts/ID', creating: true, type: 'logux/subscribe' },
    { id: '3 10:2:2 0', type: 'logux/processed' },
    { id: '4 10:2:2 0', type: 'logux/processed' },

    // second subscribe
    {
      channel: 'posts',
      filter: { projectId: '10' },
      type: 'logux/subscribe'
      // since is not set
    },
    { id: '7 10:2:2 0', type: 'logux/processed' }
  ])
})

it('sends since when subscribing to filter if actions are cached for remote offline maps', async () => {
  let client = new TestClient('10')
  client.log.keepActions()
  await client.connect()

  // when creating a filter without any cached log
  let filter1 = createFilter(client, CachedPost, {})
  await client.server.freezeProcessing(async () => {
    filter1.listen(() => {})
    await delay(1)
  })
  await filter1.loading
  await allTasks()
  expect(client.log.actions()).toEqual([
    // subscription
    { channel: 'cached', filter: {}, type: 'logux/subscribe' },
    { id: '1 10:2:2 0', type: 'logux/processed' }
  ])

  await createSyncMap(client, CachedPost, {
    id: 'ID',
    projectId: '10',
    title: 'Cached'
  })

  // when creating filter with a matching action in cache
  let filter2 = createFilter(client, CachedPost, { projectId: '10' })
  await client.server.freezeProcessing(async () => {
    filter2.listen(() => {})
    await delay(1)
  })
  await filter2.loading
  await allTasks()

  expect(client.log.actions()).toEqual([
    // first subscribe
    { channel: 'cached', filter: {}, type: 'logux/subscribe' },
    { id: '1 10:2:2 0', type: 'logux/processed' },

    // create item
    {
      fields: { projectId: '10', title: 'Cached' },
      id: 'ID',
      type: 'cached/create'
    },
    { channel: 'cached/ID', creating: true, type: 'logux/subscribe' },
    { id: '3 10:2:2 0', type: 'logux/processed' },
    { id: '4 10:2:2 0', type: 'logux/processed' },

    // second subscribe
    {
      channel: 'cached',
      filter: { projectId: '10' },
      since: { id: '3 10:2:2 0', time: 3 }, // since is set
      type: 'logux/subscribe'
    },
    { id: '7 10:2:2 0', type: 'logux/processed' }
  ])
})

it('supports both offline and remote stores', async () => {
  let client = new TestClient('10')
  client.log.keepActions()
  await client.connect()

  await createSyncMap(client, CachedPost, {
    id: 'ID',
    projectId: '10',
    title: 'Cached'
  })

  let posts = createFilter(client, CachedPost, { projectId: '10' })
  await client.server.freezeProcessing(() => {
    posts.listen(() => {})
    expect(posts.get().isLoading).toBe(true)
    return Promise.resolve()
  })
  await allTasks()
  expect(posts.get().isLoading).toBe(false)
  expect(getSize(posts)).toBe(1)
  expect(Array.from(ensureLoaded(posts.get()).stores.keys())).toEqual(['ID'])
})

it('keeps stores in memory and unsubscribes on destroy', async () => {
  let client = new TestClient('10')
  await client.connect()

  let post = Post('1', client)
  let clearPost = post.listen(() => {})
  await changeSyncMap(post, 'authorId', '10')

  let posts = createFilter(client, Post, { authorId: '10' })
  let clearFilter = posts.listen(() => {})
  clearPost()

  await delay(1020)
  expect(cachedIds(Post)).toEqual(['1'])

  clearFilter()
  await delay(2020)
  expect(cachedIds(Post)).toHaveLength(0)
})

it('updates list on store create/deleted/change', async () => {
  let client = new TestClient('10')
  await client.connect()

  let posts = createFilter(client, Post, {
    authorId: '1',
    projectId: '1'
  })
  let changes: string[] = []
  posts.listen((value, old, key) => {
    changes.push(key)
  })

  await posts.loading
  expect(getSize(posts)).toBe(0)
  expect(changes).toEqual(['isLoading'])

  await createSyncMap(client, Post, {
    authorId: '1',
    id: '1',
    projectId: '1',
    title: '1'
  })
  expect(getSize(posts)).toBe(1)
  expect(changes).toEqual(['isLoading', 'list', 'isEmpty'])

  let post2 = await buildNewSyncMap(client, Post, {
    authorId: '2',
    id: '2',
    projectId: '2',
    title: '2'
  })
  post2.listen(() => {})
  expect(getSize(posts)).toBe(1)

  await changeSyncMapById(client, Post, '2', 'title', '1')
  expect(getSize(posts)).toBe(1)

  await changeSyncMapById(client, Post, '2', 'projectId', '1')
  expect(getSize(posts)).toBe(1)

  await changeSyncMapById(client, Post, '2', 'authorId', '1')
  expect(getSize(posts)).toBe(2)
  expect(changes).toEqual(['isLoading', 'list', 'isEmpty', 'list'])

  await changeSyncMapById(client, Post, '2', 'authorId', '2')
  expect(getSize(posts)).toBe(1)
  expect(changes).toEqual([
    'isLoading',
    'list',
    'isEmpty',
    'list',
    'list',
    'list'
  ])

  await deleteSyncMapById(client, Post, '1')
  expect(getSize(posts)).toBe(0)
  expect(changes).toEqual([
    'isLoading',
    'list',
    'isEmpty',
    'list',
    'list',
    'list',
    'list',
    'isEmpty'
  ])
})

it('updates list on store created/deleted/changed', async () => {
  let client = new TestClient('10')
  client.log.keepActions()

  let posts = createFilter(client, LocalPost, {
    category: 'test',
    projectId: '1'
  })
  posts.listen(() => {})

  await posts.loading
  expect(getSize(posts)).toBe(0)

  await createSyncMap(client, LocalPost, {
    category: 'test',
    id: '1',
    projectId: '1',
    title: '1'
  })
  expect(getSize(posts)).toBe(1)

  let post2 = await buildNewSyncMap(client, LocalPost, {
    category: 'wrong',
    id: '2',
    projectId: '2',
    title: '2'
  })
  post2.listen(() => {})
  expect(getSize(posts)).toBe(1)

  await changeSyncMap(post2, 'title', '1')
  expect(getSize(posts)).toBe(1)

  await changeSyncMap(post2, 'projectId', '1')
  expect(getSize(posts)).toBe(1)

  await changeSyncMap(post2, 'category', 'test')
  expect(getSize(posts)).toBe(2)

  await changeSyncMap(post2, 'category', 'wrong')
  expect(getSize(posts)).toBe(1)

  await deleteSyncMapById(client, LocalPost, '1')
  expect(getSize(posts)).toBe(0)
})

it('unsubscribes from store on delete', async () => {
  let client = new TestClient('10')
  await client.connect()

  let post = Post('1', client)
  let unbind = post.listen(() => {})

  let posts = createFilter(client, Post, { authorId: '10' })
  posts.listen(() => {})

  await changeSyncMap(post, 'authorId', '10')
  expect(cachedIds(Post)).toEqual(['1'])
  unbind()

  await changeSyncMap(post, 'authorId', '20')
  await delay(1020)

  expect(cachedIds(Post)).toHaveLength(0)
})

it('uses time for delete actions', async () => {
  let client = new TestClient('10')
  await client.connect()

  let oldId = client.log.generateId()

  let posts = createFilter(client, Post)
  posts.listen(() => {})
  await createSyncMap(client, Post, {
    authorId: '1',
    id: 'ID',
    projectId: '1',
    title: '1'
  })
  expect(getSize(posts)).toBe(1)

  await client.sync({ id: 'ID', type: 'posts/delete' }, { id: oldId, time: 0 })
  expect(getSize(posts)).toBe(1)

  await client.sync({ id: 'ID', type: 'posts/delete' })
  expect(getSize(posts)).toBe(0)
})

it('triggers on child changes', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('1', client)
  post.listen(() => {})
  await changeSyncMap(post, 'authorId', '10')

  let posts = createFilter(client, Post, { authorId: '10' })
  posts.listen(() => {})
  let calls: (string | undefined)[] = []
  posts.subscribe((value, old, key) => {
    calls.push(key)
  })
  await posts.loading
  expect(calls).toEqual([undefined, 'isLoading'])

  await changeSyncMap(post, 'title', 'New')
  expect(calls).toEqual([undefined, 'isLoading', 'list'])

  await changeSyncMap(post, 'authorId', '20')
  expect(calls).toEqual([
    undefined,
    'isLoading',
    'list',
    'list',
    'list',
    'isEmpty'
  ])
})

it('can ignore child changes', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('1', client)
  post.listen(() => {})
  await changeSyncMap(post, 'authorId', '10')

  let posts = createFilter(
    client,
    Post,
    { authorId: '10' },
    { listChangesOnly: true }
  )
  posts.listen(() => {})
  let calls: (string | undefined)[] = []
  posts.subscribe((value, old, key) => {
    calls.push(key)
  })
  await posts.loading
  expect(calls).toEqual([undefined, 'isLoading'])

  await changeSyncMap(post, 'title', 'New')
  await changeSyncMap(post, 'authorId', '20')
  expect(calls).toEqual([undefined, 'isLoading', 'list', 'isEmpty'])
})

it('is ready create/delete/change undo', async () => {
  let client = new TestClient('10')
  await client.connect()

  let posts = createFilter(client, Post, { projectId: '1' })
  posts.listen(() => {})
  await posts.loading

  client.server.undoNext()
  await client.server.freezeProcessing(async () => {
    createSyncMap(client, Post, {
      authorId: '1',
      id: '1',
      projectId: '1',
      title: '1'
    }).catch(() => {})
    await delay(1)
    expect(getSize(posts)).toBe(1)
  })
  expect(getSize(posts)).toBe(0)

  await createSyncMap(client, Post, {
    authorId: '1',
    id: '2',
    projectId: '1',
    title: '2'
  })
  expect(getSize(posts)).toBe(1)

  client.server.undoNext()
  await client.server.freezeProcessing(async () => {
    deleteSyncMapById(client, Post, '2').catch(() => {})
    await delay(1)
    expect(getSize(posts)).toBe(0)
  })
  expect(getSize(posts)).toBe(1)

  client.server.undoNext()
  await client.server.freezeProcessing(async () => {
    changeSyncMapById(client, Post, '2', 'projectId', 'wrong').catch(() => {})
    await delay(1)
    expect(getSize(posts)).toBe(0)
  })
  expect(getSize(posts)).toBe(1)
  expect(Post('2', client).get()).toEqual({
    authorId: '1',
    id: '2',
    isLoading: false,
    projectId: '1',
    title: '2'
  })

  let post3 = Post('3', client)
  post3.listen(() => {})
  await post3.loading

  client.server.undoNext()
  await client.server.freezeProcessing(async () => {
    changeSyncMap(post3, 'projectId', '1').catch(() => {})
    await delay(1)
    expect(getSize(posts)).toBe(2)
  })
  expect(getSize(posts)).toBe(1)

  client.server.undoNext()
  await client.server.freezeProcessing(async () => {
    changeSyncMap(post3, 'projectId', '1').catch(() => {})
    client.log.add({
      fields: { projectId: '1' },
      id: '3',
      type: 'posts/changed'
    })
    await delay(1)
    expect(getSize(posts)).toBe(2)
  })
  expect(getSize(posts)).toBe(2)

  cleanStores(Post)
  await delay(50)

  expect(client.log.actions()).toEqual([])
})

it('loads store on change action without cache', async () => {
  let client = new TestClient('10')
  await client.connect()

  let posts = createFilter(client, Post)
  posts.listen(() => {})
  expect(
    await client.sent(async () => {
      await client.log.add({
        fields: { title: '1' },
        id: '1',
        type: 'posts/change'
      })
      await client.log.add({
        fields: { title: '2' },
        id: '2',
        type: 'posts/changed'
      })
    })
  ).toEqual([
    { channel: 'posts', filter: {}, type: 'logux/subscribe' },
    { channel: 'posts/1', type: 'logux/subscribe' },
    { channel: 'posts/2', type: 'logux/subscribe' }
  ])
  await allTasks()
  expect(getSize(posts)).toBe(2)
})

it('is ready for subscription error', async () => {
  let client = new TestClient('10')
  await client.connect()

  let posts = createFilter(client, Post)
  client.server.undoNext()
  let unbind = posts.listen(() => {})

  let catched = false
  posts.loading.catch(e => {
    if (e.name === 'LoguxUndoError') {
      catched = true
    } else {
      throw e
    }
  })

  await allTasks()
  expect(catched).toBe(true)

  expect(
    await client.sent(async () => {
      unbind()
      await allTasks()
    })
  ).toEqual([])
})

it('has shortcut to check size', async () => {
  let client = new TestClient('10')
  await client.connect()

  let posts = createFilter(client, Post, { authorId: '10' })
  posts.listen(() => {})
  expect((await loadValue(posts)).isEmpty).toBe(true)

  await createSyncMap(client, Post, {
    authorId: '10',
    id: '1',
    projectId: '20',
    title: '1'
  })
  expect(ensureLoaded(posts.get()).isEmpty).toBe(false)
})

it('clean filters', () => {
  let client = new TestClient('10')
  client.log.keepActions()

  let filter1a = createFilter(client, Post, { projectId: '1' })
  let filter2a = createFilter(client, Post, { projectId: '2' })
  filter2a.listen(() => {})

  cleanStores(Post)

  let filter1b = createFilter(client, Post, { projectId: '1' })
  let filter2b = createFilter(client, Post, { projectId: '2' })
  filter2b.listen(() => {})
  expect(filter1a).not.toBe(filter1b)
  expect(filter2a).not.toBe(filter2b)

  expect(client.log.actions()).toHaveLength(3)
})
