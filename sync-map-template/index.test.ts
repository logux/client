import { defineChangedSyncMap, defineChangeSyncMap } from '@logux/actions'
import { delay } from 'nanodelay'
import { allTasks, cleanStores } from 'nanostores'
import { afterEach, expect, it } from 'vitest'

import {
  buildNewSyncMap,
  changeSyncMap,
  changeSyncMapById,
  createSyncMap,
  deleteSyncMap,
  deleteSyncMapById,
  ensureLoaded,
  loadValue,
  syncMapTemplate,
  type SyncMapValue,
  TestClient
} from '../index.js'

async function catchError(cb: () => Promise<any> | void): Promise<Error> {
  let error: Error | undefined
  try {
    await cb()
  } catch (e) {
    if (e instanceof Error) error = e
  }
  if (!error) throw new Error('Error was no raised')
  return error
}

type PostValue = {
  author?: string
  category?: string
  title: string
}

let Post = syncMapTemplate<PostValue>('posts')

let CachedPost = syncMapTemplate<{
  title: string
}>('cachedPosts', {
  offline: true
})

let LocalPost = syncMapTemplate<{
  category?: string
  title: string
}>('localPosts', {
  offline: true,
  remote: false
})

let createChangeAction = defineChangeSyncMap<PostValue>('posts')
let createChangedAction = defineChangedSyncMap<PostValue>('posts')

function changeAction(
  fields: Partial<PostValue>,
  id: string = 'ID'
): ReturnType<typeof createChangeAction> {
  return createChangeAction({ fields, id })
}

function changedAction(
  fields: Partial<PostValue>,
  id: string = 'ID'
): ReturnType<typeof createChangedAction> {
  return createChangedAction({ fields, id })
}

function createAutoprocessingClient(): TestClient {
  let client = new TestClient('10')
  client.on('add', (action, meta) => {
    if (action.type === 'logux/subscribe') {
      client.log.add({ id: meta.id, type: 'logux/processed' })
    }
  })
  return client
}

function clone<From extends object>(obj: From): From {
  return JSON.parse(JSON.stringify(obj))
}

afterEach(async () => {
  cleanStores(Post, CachedPost, LocalPost)
})

it('saves options to class', () => {
  expect(CachedPost.plural).toBe('cachedPosts')
  expect(CachedPost.offline).toBe(true)
  expect(CachedPost.remote).toBe(true)
  expect(LocalPost.remote).toBe(false)
})

it('saves options to store', () => {
  let client = new TestClient('10')
  let cached = CachedPost('ID', client)
  cached.listen(() => {})
  expect(cached.plural).toBe('cachedPosts')
  expect(cached.offline).toBe(true)
  expect(cached.remote).toBe(true)
})

it('throws on missed client', () => {
  let post = Post('ID')
  expect(() => {
    post.listen(() => {})
  }).toThrow('Missed Logux client')
})

it('subscribes and unsubscribes', async () => {
  let client = new TestClient('10')
  await client.connect()

  let post = Post('ID', client)
  let unbind = (): void => {}
  await client.server.freezeProcessing(async () => {
    unbind = post.listen(() => {})
    expect(post.get().isLoading).toBe(true)
  })

  await Promise.resolve()
  expect(post.get().isLoading).toBe(false)
  expect(client.subscribed('posts/ID')).toBe(true)

  unbind()
  await delay(1020)
  expect(client.subscribed('posts/ID')).toBe(false)
})

it('changes key', async () => {
  let client = createAutoprocessingClient()
  await client.connect()

  let post = Post('ID', client)
  let changes: SyncMapValue<PostValue>[] = []
  post.subscribe(value => {
    changes.push(clone(value))
  })

  expect(post.get()).toEqual({
    id: 'ID',
    isLoading: true
  })

  await post.loading

  changeSyncMap(post, 'title', '1')
  expect(post.get()).toEqual({
    id: 'ID',
    isLoading: false,
    title: '1'
  })
  expect(changes).toEqual([
    { id: 'ID', isLoading: true },
    { id: 'ID', isLoading: false },
    { id: 'ID', isLoading: false, title: '1' }
  ])

  changeSyncMapById(client, Post, 'ID', 'category', 'demo')
  expect(post.get()).toEqual({
    id: 'ID',
    isLoading: false,
    title: '1'
  })

  await allTasks()
  expect(post.get()).toEqual({
    category: 'demo',
    id: 'ID',
    isLoading: false,
    title: '1'
  })

  let actions = await client.sent(async () => {
    await changeSyncMap(post, 'title', '2')
  })
  expect(actions).toEqual([changeAction({ title: '2' })])

  await client.log.add(changeAction({ title: '3' }), { sync: true })
  expect(post.get()).toEqual({
    category: 'demo',
    id: 'ID',
    isLoading: false,
    title: '3'
  })

  client.server.log.add(changedAction({ title: '4' }))
  await allTasks()
  expect(post.get()).toEqual({
    category: 'demo',
    id: 'ID',
    isLoading: false,
    title: '4'
  })

  expect(client.log.actions()).toEqual([
    changeAction({ category: 'demo' }),
    changedAction({ title: '4' })
  ])
})

it('cleans log', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('ID', client)
  let unbind = post.listen(() => {})

  await changeSyncMap(post, 'title', '1')
  await changeSyncMap(post, 'title', '1')

  unbind()
  await delay(1020)
  expect(client.log.actions()).toEqual([])
})

it('returns Promise on changing', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('ID', client)
  post.listen(() => {})

  let resolved = false
  await client.server.freezeProcessing(async () => {
    changeSyncMap(post, 'title', '1').then(() => {
      resolved = true
    })
    await delay(10)
    expect(resolved).toBe(false)
  })
  expect(resolved).toBe(true)
})

it('ignores old actions', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('ID', client)
  post.listen(() => {})

  await changeSyncMap(post, 'title', 'New')
  await client.sync(changeAction({ title: 'Old 1' }), { time: 0 })
  await client.server.log.add(changedAction({ title: 'Old 2' }), { time: 0 })
  await allTasks()

  expect(post.get()).toEqual({
    id: 'ID',
    isLoading: false,
    title: 'New'
  })
  expect(client.log.actions()).toEqual([changeAction({ title: 'New' })])
})

it('reverts changes for simple case', async () => {
  let client = createAutoprocessingClient()
  await client.connect()
  let post = Post('ID', client)
  post.listen(() => {})

  await post.loading
  await changeSyncMap(post, 'title', 'Good')

  client.server.undoNext()
  let promise = changeSyncMap(post, 'title', 'Bad')
  expect(post.get()).toEqual({
    id: 'ID',
    isLoading: false,
    title: 'Bad'
  })

  let error = await catchError(() => promise)
  expect(error.message).toBe('Server undid posts/change because of error')

  await allTasks()
  expect(post.get()).toEqual({
    id: 'ID',
    isLoading: false,
    title: 'Good'
  })
  expect(client.log.actions()).toEqual([changeAction({ title: 'Good' })])
})

it('reverts changes for multiple actions case', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('ID', client)
  post.listen(() => {})

  client.server.undoAction(changeAction({ title: 'Bad' }))
  await changeSyncMap(post, 'title', 'Good 1')
  await client.server.freezeProcessing(async () => {
    changeSyncMap(post, 'title', 'Bad').catch(() => {})
    await delay(10)
    await client.log.add(changedAction({ title: 'Good 2' }), { time: 4 })
  })

  expect(post.get()).toEqual({
    id: 'ID',
    isLoading: false,
    title: 'Good 2'
  })
})

it('filters action by ID', async () => {
  let client = new TestClient('10')
  await client.connect()

  let post1 = Post('1', client)
  let post2 = Post('2', client)
  post1.listen(() => {})
  post2.listen(() => {})

  await changeSyncMap(post1, 'title', 'A')
  await changeSyncMap(post2, 'title', 'B')
  await client.log.add(changedAction({ title: 'C' }, '2'))

  client.server.undoNext()
  changeSyncMap(post1, 'title', 'Bad').catch(() => {})
  await allTasks()

  expect(post1.get()).toEqual({
    id: '1',
    isLoading: false,
    title: 'A'
  })
  expect(post2.get()).toEqual({
    id: '2',
    isLoading: false,
    title: 'C'
  })
})

it('supports bulk changes', async () => {
  let client = createAutoprocessingClient()
  await client.connect()
  let post = Post('ID', client)
  post.listen(() => {})

  await post.loading

  await changeSyncMap(post, { category: 'demo', title: '1' })
  await changeSyncMap(post, { title: '1' })
  await changeSyncMap(post, { title: '3' })
  await client.sync(changeAction({ author: 'Yaropolk', title: '2' }), {
    time: 4
  })
  expect(post.get()).toEqual({
    author: 'Yaropolk',
    category: 'demo',
    id: 'ID',
    isLoading: false,
    title: '3'
  })

  client.server.undoNext()
  changeSyncMap(post, { author: 'Badly', category: 'bad' }).catch(() => {})
  await allTasks()

  expect(post.get()).toEqual({
    author: 'Yaropolk',
    category: 'demo',
    id: 'ID',
    isLoading: false,
    title: '3'
  })
})

it('could cache specific stores without server', async () => {
  let client = new TestClient('10')
  client.on('preadd', (action, meta) => {
    if (action.type === 'localPosts/created') {
      meta.reasons.push('test')
    }
  })
  await createSyncMap(client, LocalPost, {
    category: 'demo',
    id: 'ID',
    title: 'Previous'
  })
  let post = LocalPost('ID', client)

  let unbind = (): void => {}
  let sent = await client.sent(async () => {
    unbind = post.listen(() => {})
    await changeSyncMap(post, 'title', '1')
  })
  expect(sent).toEqual([])

  await changeSyncMap(post, 'title', 'The post')
  unbind()
  await allTasks()

  expect(client.log.actions()).toEqual([
    {
      fields: {
        category: 'demo',
        title: 'Previous'
      },
      id: 'ID',
      type: 'localPosts/created'
    },
    { fields: { title: 'The post' }, id: 'ID', type: 'localPosts/changed' }
  ])

  let restored = LocalPost('ID', client)
  restored.listen(() => {})
  await restored.loading
  expect(restored.get()).toEqual({
    category: 'demo',
    id: 'ID',
    isLoading: false,
    title: 'The post'
  })
})

it('throws on error from server', async () => {
  let client = new TestClient('10')
  await client.connect()

  client.server.undoNext()
  let post = Post('ID', client)
  let unbind = post.listen(() => {})

  let error: Error | undefined
  try {
    await post.loading
  } catch (e) {
    if (e instanceof Error) error = e
  }

  await allTasks()
  expect(error?.message).toBe('Server undid logux/subscribe because of error')

  unbind()
  await delay(50)
})

it('throws 404 on missing offline map in local log', async () => {
  let client = new TestClient('10')
  let post = LocalPost('ID', client)
  post.listen(() => {})

  let error: Error | undefined
  try {
    await post.loading
  } catch (e) {
    if (e instanceof Error) error = e
  }

  expect(error?.message).toBe(
    'Server undid logux/subscribe because of notFound'
  )
})

it('should not send since when subscribing to a offline remote store for the first time', async () => {
  let client = new TestClient('10')
  await client.connect()
  client.log.keepActions()

  let post = CachedPost('ID', client)
  post.listen(() => {})
  await allTasks()

  expect(client.log.actions()).toEqual([
    // since is not sent
    { channel: 'cachedPosts/ID', type: 'logux/subscribe' },
    { id: '1 10:2:2 0', type: 'logux/processed' }
  ])
})

it('could cache specific stores and use server', async () => {
  let client = new TestClient('10')
  await client.connect()
  client.log.keepActions()
  let post = CachedPost('ID', client)
  let unbind = post.listen(() => {})

  await allTasks()

  expect(client.log.actions()).toEqual([
    { channel: 'cachedPosts/ID', type: 'logux/subscribe' },
    { id: '1 10:2:2 0', type: 'logux/processed' }
  ])

  await changeSyncMap(post, 'title', 'The post')
  unbind()
  await allTasks()

  expect(client.log.actions()).toEqual([
    { channel: 'cachedPosts/ID', type: 'logux/subscribe' },
    { id: '1 10:2:2 0', type: 'logux/processed' },

    { fields: { title: 'The post' }, id: 'ID', type: 'cachedPosts/change' },
    { fields: { title: 'The post' }, id: 'ID', type: 'cachedPosts/changed' },

    { id: '3 10:2:2 0', type: 'logux/processed' }
  ])

  let restored = CachedPost('ID', client)
  restored.listen(() => {})
  await allTasks()
  expect(restored.get()).toEqual({
    id: 'ID',
    isLoading: false,
    title: 'The post'
  })
})

it('creates maps', async () => {
  let client = new TestClient('10')
  let created = false
  createSyncMap(client, Post, {
    author: 'Ivan',
    category: 'none',
    id: 'random',
    title: 'Test'
  }).then(() => {
    created = true
  })

  expect(client.log.actions()).toEqual([
    {
      fields: {
        author: 'Ivan',
        category: 'none',
        title: 'Test'
      },
      id: 'random',
      type: 'posts/create'
    }
  ])

  await delay(1)
  expect(created).toBe(false)

  await client.log.add({
    id: client.log.entries()[0][1].id,
    type: 'logux/processed'
  })
  await delay(1)
  expect(created).toBe(true)
})

it('deletes maps', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('DEL', client)
  post.listen(() => {})

  await changeSyncMap(post, 'title', 'Deleted')

  let deleted = false
  await client.server.freezeProcessing(async () => {
    deleteSyncMap(post).then(() => {
      deleted = true
    })
    expect(client.log.actions()).toEqual([
      { fields: { title: 'Deleted' }, id: 'DEL', type: 'posts/change' },
      { id: 'DEL', type: 'posts/delete' }
    ])
    await delay(1)
    expect(deleted).toBe(false)
  })
  expect(deleted).toBe(true)
  expect(client.log.actions()).toEqual([])
})

it('creates and deletes local maps on uncleaned log', async () => {
  let client = new TestClient('10')
  client.log.keepActions()

  await createSyncMap(client, LocalPost, { id: 'DEL', title: 'New' })
  let post1 = LocalPost('DEL', client)
  let unbind = post1.listen(() => {})
  await changeSyncMap(post1, { category: 'deleted', title: 'Deleted' })
  await deleteSyncMap(post1)

  unbind()
  await delay(1020)

  await createSyncMap(client, LocalPost, { id: 'DEL', title: 'New' })
  let post2 = LocalPost('DEL', client)
  post2.listen(() => {})
  await post2.loading
  expect(post2.get()).toEqual({
    id: 'DEL',
    isLoading: false,
    title: 'New'
  })
})

it('uses created and delete during undo', async () => {
  let client = new TestClient('10')
  await client.connect()
  client.log.keepActions()

  let post1 = Post('ID', client)
  post1.listen(() => {})
  await changeSyncMap(post1, 'title', 'Deleted')
  await changeSyncMap(post1, 'author', 'Deleter')
  await deleteSyncMap(post1)

  await createSyncMap(client, Post, { id: 'ID', title: 'New' })
  let post2 = Post('ID', client)
  post2.listen(() => {})

  client.server.undoNext()
  await changeSyncMap(post2, { author: 'Bad', title: 'Bad' }).catch(() => {})
  await allTasks()
  expect(post2.get()).toEqual({
    id: 'ID',
    isLoading: false,
    title: 'New'
  })
})

it('supports deleted action', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('DEL', client)
  post.listen(() => {})

  await changeSyncMap(post, 'title', 'Deleted')
  await client.log.add({ id: 'DEL', type: 'posts/deleted' })

  expect(client.log.actions()).toEqual([])
})

it('deletes without store loading', async () => {
  let client = new TestClient('10')
  await client.connect()
  expect(
    await client.sent(async () => {
      await deleteSyncMapById(client, Post, 'DEL')
    })
  ).toEqual([{ id: 'DEL', type: 'posts/delete' }])
})

it('undos delete', async () => {
  let client = new TestClient('10')
  await client.connect()
  let post = Post('DEL', client)
  post.listen(() => {})

  await changeSyncMap(post, 'title', 'Deleted')

  let deleted: boolean | undefined
  client.server.undoNext()
  deleteSyncMap(post)
    .then(() => {
      deleted = true
    })
    .catch(() => {
      deleted = false
    })
  await allTasks()
  expect(deleted).toBe(false)
  expect(client.log.actions()).toEqual([
    { fields: { title: 'Deleted' }, id: 'DEL', type: 'posts/change' }
  ])
})

it('allows to send create action and return instance', async () => {
  let client = new TestClient('10')
  await client.connect()
  expect(
    await client.sent(async () => {
      let post = await buildNewSyncMap(client, Post, {
        author: 'Ivan',
        category: 'none',
        id: 'ID',
        title: 'Test'
      })
      post.listen(() => {})
      expect(post.get()).toEqual({
        author: 'Ivan',
        category: 'none',
        id: 'ID',
        isLoading: false,
        title: 'Test'
      })
      expect(post.createdAt?.id).toBe('1 10:2:2 0')
      expect(post.createdAt?.time).toBe(1)
    })
  ).toEqual([
    {
      fields: {
        author: 'Ivan',
        category: 'none',
        title: 'Test'
      },
      id: 'ID',
      type: 'posts/create'
    },
    { channel: 'posts/ID', creating: true, type: 'logux/subscribe' }
  ])
})

it('does not send subscription on local store creation', async () => {
  let client = new TestClient('10')
  await client.connect()
  expect(
    await client.sent(async () => {
      let post = await buildNewSyncMap(client, LocalPost, {
        category: 'none',
        id: 'ID',
        title: 'Test'
      })
      post.listen(() => {})
      expect(post.get()).toEqual({
        category: 'none',
        id: 'ID',
        isLoading: false,
        title: 'Test'
      })
    })
  ).toEqual([])
  expect(client.log.actions()).toEqual([
    {
      fields: { category: 'none', title: 'Test' },
      id: 'ID',
      type: 'localPosts/created'
    }
  ])
})

it('loads data by created action', async () => {
  let client = new TestClient('10')
  client.log.keepActions()
  await client.connect()

  let post = Post('1', client)
  post.listen(() => {})

  await client.log.add({
    fields: { category: 'demo', title: 'A' },
    id: '1',
    type: 'posts/created'
  })
  expect(post.get()).toEqual({
    category: 'demo',
    id: '1',
    isLoading: true,
    title: 'A'
  })
})

it('has helper to insure that store is loaded', async () => {
  let client = createAutoprocessingClient()
  await client.connect()

  let post = Post('ID', client)
  let changes: SyncMapValue<PostValue>[] = []
  post.subscribe(value => {
    changes.push(clone(value))
  })

  expect(() => {
    ensureLoaded(post.get())
  }).toThrow('Store was not loaded yet')

  await post.loading
  expect(ensureLoaded(post.get())).toEqual({
    id: 'ID',
    isLoading: false
  })
})

it('has helper to load value', async () => {
  let client = new TestClient('10')
  await createSyncMap(client, LocalPost, {
    id: '1',
    title: 'A'
  })

  let post1 = LocalPost('1', client)
  expect(await loadValue(post1)).toEqual({
    id: '1',
    isLoading: false,
    title: 'A'
  })

  await createSyncMap(client, LocalPost, {
    id: '2',
    title: 'B'
  })
  let post2 = LocalPost('2', client)
  await post2.loading
  expect(await loadValue(post2)).toEqual({
    id: '2',
    isLoading: false,
    title: 'B'
  })
})

it('keeps action in a log for local values', async () => {
  let client = new TestClient('10')
  await createSyncMap(client, LocalPost, {
    category: 'first',
    id: '1',
    title: 'A'
  })
  await buildNewSyncMap(client, LocalPost, {
    id: '2',
    title: 'B'
  })
  expect(client.log.actions()).toEqual([
    {
      fields: { category: 'first', title: 'A' },
      id: '1',
      type: 'localPosts/created'
    },
    {
      fields: { title: 'B' },
      id: '2',
      type: 'localPosts/created'
    }
  ])

  await changeSyncMapById(client, LocalPost, '1', { title: 'A1' })
  expect(client.log.actions()).toEqual([
    {
      fields: { category: 'first', title: 'A' },
      id: '1',
      type: 'localPosts/created'
    },
    {
      fields: { title: 'B' },
      id: '2',
      type: 'localPosts/created'
    },
    {
      fields: { title: 'A1' },
      id: '1',
      type: 'localPosts/changed'
    }
  ])

  await changeSyncMapById(client, LocalPost, '1', { title: 'A2' })
  expect(client.log.actions()).toEqual([
    {
      fields: { category: 'first', title: 'A' },
      id: '1',
      type: 'localPosts/created'
    },
    {
      fields: { title: 'B' },
      id: '2',
      type: 'localPosts/created'
    },
    {
      fields: { title: 'A2' },
      id: '1',
      type: 'localPosts/changed'
    }
  ])

  await changeSyncMapById(client, LocalPost, '1', { category: 'second' })
  expect(client.log.actions()).toEqual([
    {
      fields: { title: 'B' },
      id: '2',
      type: 'localPosts/created'
    },
    {
      fields: { title: 'A2' },
      id: '1',
      type: 'localPosts/changed'
    },
    {
      fields: { category: 'second' },
      id: '1',
      type: 'localPosts/changed'
    }
  ])

  await deleteSyncMapById(client, LocalPost, '2')
  expect(client.log.actions()).toEqual([
    {
      fields: { title: 'A2' },
      id: '1',
      type: 'localPosts/changed'
    },
    {
      fields: { category: 'second' },
      id: '1',
      type: 'localPosts/changed'
    }
  ])

  await deleteSyncMapById(client, LocalPost, '1')
  expect(client.log.actions()).toEqual([])
})
