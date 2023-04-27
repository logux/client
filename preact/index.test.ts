import {
  FunctionComponent as FC,
  ComponentChild,
  Component,
  VNode,
  h
} from 'preact'
import { cleanStores, atom, map, onMount, MapStore } from 'nanostores'
import { render, screen, act, cleanup } from '@testing-library/preact'
import { it, expect, afterEach } from 'vitest'
import { LoguxNotFoundError } from '@logux/actions'
import { spyOn, restoreAll } from 'nanospy'
import { useState } from 'preact/hooks'
import { delay } from 'nanodelay'

import {
  ChannelNotFoundError,
  SyncMapTemplateLike,
  ChannelDeniedError,
  changeSyncMapById,
  SyncMapTemplate,
  syncMapTemplate,
  createSyncMap,
  LoguxUndoError,
  ChannelError,
  TestClient
} from '../index.js'
import {
  ClientContext,
  ChannelErrors,
  useClient,
  useFilter,
  useSync,
  useAuth
} from './index.js'

function getCatcher(cb: () => void): [string[], FC] {
  let errors: string[] = []
  let Catcher: FC = () => {
    try {
      cb()
    } catch (e) {
      if (e instanceof Error) errors.push(e.message)
    }
    return null
  }
  return [errors, Catcher]
}

let brokenReject: ((e: Error) => void) | undefined

function throwFromBroken(e: Error | string): void {
  if (brokenReject) {
    if (typeof e === 'string') {
      brokenReject(
        new LoguxUndoError({
          type: 'logux/undo',
          reason: e,
          id: '',
          action: {
            type: 'logux/subscribe',
            channel: 'A'
          }
        })
      )
    } else {
      brokenReject(e)
    }
  }
}

type BrokenMap = MapStore<{ isLoading: boolean }> & { loading: Promise<void> }

let Broken = (): BrokenMap => {
  let store = map({ isLoading: true }) as BrokenMap
  onMount(store, () => {
    store.loading = new Promise((resolve, reject) => {
      brokenReject = reject
    })
  })
  return store
}

let IdTest: FC<{ Template: SyncMapTemplateLike }> = ({ Template }) => {
  let store = useSync(Template, 'ID')
  return h('div', {}, store.isLoading ? 'loading' : store.id)
}

let SyncTest: FC<{ Template: SyncMapTemplate }> = ({ Template }) => {
  let store = useSync(Template, 'ID')
  return h('div', {}, store.isLoading ? 'loading' : store.id)
}

function getText(component: VNode): string | null {
  let client = new TestClient('10')
  render(
    h(ClientContext.Provider, {
      value: client,
      // @ts-expect-error
      children: h('div', { 'data-testid': 'test' }, component)
    })
  )
  return screen.getByTestId('test').textContent
}

function runWithClient(component: VNode): void {
  let client = new TestClient('10')
  render(
    h(ClientContext.Provider, {
      value: client,
      children: h(ChannelErrors, { Error: () => null }, component)
    })
  )
}

class ErrorCatcher extends Component {
  state: { message?: string } = {}

  static getDerivedStateFromError(e: Error): object {
    return { message: e.message }
  }

  render(): ComponentChild {
    if (typeof this.state.message === 'string') {
      return h('div', {}, this.state.message)
    } else {
      return this.props.children
    }
  }
}

async function catchLoadingError(
  error: string | Error
): Promise<string | null> {
  spyOn(console, 'error', () => {})
  let Bad: FC = () => h('div', null, 'bad')
  let NotFound: FC<{ error: ChannelNotFoundError | LoguxNotFoundError }> = p =>
    h('div', {}, `404 ${p.error.name}`)
  let AccessDenied: FC<{ error: ChannelDeniedError }> = props => {
    return h('div', {}, `403 ${props.error.action.reason}`)
  }
  let Error: FC<{ error: ChannelError }> = props => {
    return h('div', {}, `500 ${props.error.action.reason}`)
  }

  runWithClient(
    h(
      // @ts-expect-error
      'div',
      { 'data-testid': 'test' },
      h(
        ErrorCatcher,
        {},
        h(
          ChannelErrors,
          { AccessDenied, NotFound: Bad, Error },
          h(
            ChannelErrors,
            { NotFound },
            h(ChannelErrors, {}, h(IdTest, { Template: Broken }))
          )
        )
      )
    )
  )
  expect(screen.getByTestId('test').textContent).toEqual('loading')

  await act(async () => {
    throwFromBroken(error)
    await delay(1)
  })
  return screen.getByTestId('test').textContent
}

let LocalPost = syncMapTemplate<{ projectId: string; title: string }>('local', {
  offline: true,
  remote: false
})

let RemotePost = syncMapTemplate<{ title?: string }>('posts')

afterEach(() => {
  cleanup()
  restoreAll()
  cleanStores(LocalPost, RemotePost)
})

it('throws on missed context for sync map', () => {
  let Test = syncMapTemplate<{ name: string }>('test')
  let [errors, Catcher] = getCatcher(() => {
    useSync(Test, 'ID')
  })
  render(h(Catcher, null))
  expect(errors).toEqual(['Wrap components in Logux <ClientContext.Provider>'])
})

it('throws on missed context for useClient', () => {
  let [errors, Catcher] = getCatcher(() => {
    useClient()
  })
  render(h(Catcher, null))
  expect(errors).toEqual(['Wrap components in Logux <ClientContext.Provider>'])
})

it('throws store init errors', () => {
  let Template = (): MapStore => {
    let store = map()
    onMount(store, () => {
      throw new Error('Test')
    })
    return store
  }
  let [errors, Catcher] = getCatcher(() => {
    useSync(Template, 'id')
  })
  runWithClient(h(Catcher, null))
  expect(errors).toEqual(['Test'])
})

it('throws on missed ID for builder', async () => {
  let store = atom<undefined>()
  let [errors, Catcher] = getCatcher(() => {
    // @ts-expect-error
    useSync(store)
  })
  render(h(Catcher, null))
  expect(errors).toEqual(['Use useStore() from @nanostores/preact for stores'])
})

it('throws and catches not found error', async () => {
  expect(await catchLoadingError(new LoguxNotFoundError())).toBe(
    '404 LoguxNotFoundError'
  )
})

it('throws and catches not found error from server', async () => {
  expect(await catchLoadingError('notFound')).toBe('404 LoguxUndoError')
})

it('throws and catches access denied error', async () => {
  expect(await catchLoadingError('denied')).toBe('403 denied')
})

it('throws and catches access server error during loading', async () => {
  expect(await catchLoadingError('error')).toBe('500 error')
})

it('ignores unknown error', async () => {
  expect(await catchLoadingError(new Error('Test Error'))).toBe('Test Error')
})

it('could process denied via common error component', async () => {
  spyOn(console, 'error', () => {})
  let Error: FC<{ error: ChannelError }> = props => {
    return h('div', {}, `500 ${props.error.action.reason}`)
  }
  runWithClient(
    h(
      // @ts-expect-error
      'div',
      { 'data-testid': 'test' },
      h(ChannelErrors, { Error }, h(IdTest, { Template: Broken }))
    )
  )
  await act(async () => {
    throwFromBroken('denied')
    await delay(1)
  })
  expect(screen.getByTestId('test').textContent).toEqual('500 denied')
})

it('could process not found via common error component', async () => {
  spyOn(console, 'error', () => {})
  let Error: FC<{ error: ChannelError }> = props => {
    return h('div', {}, `500 ${props.error.action.reason}`)
  }
  runWithClient(
    h(
      // @ts-expect-error
      'div',
      { 'data-testid': 'test' },
      h(ChannelErrors, { Error }, h(IdTest, { Template: Broken }))
    )
  )
  await act(async () => {
    throwFromBroken('notFound')
    await delay(1)
  })
  expect(screen.getByTestId('test').textContent).toEqual('500 notFound')
})

it('throws an error on missed ChannelErrors', async () => {
  spyOn(console, 'error', () => {})
  expect(
    getText(h(ErrorCatcher, {}, h(SyncTest, { Template: RemotePost })))
  ).toEqual(
    'Wrap components in Logux ' +
      '<ChannelErrors NotFound={Page404} AccessDenied={Page403}>'
  )
})

it('throws an error on ChannelErrors with missed argument', async () => {
  spyOn(console, 'error', () => {})
  expect(
    getText(
      h(
        ErrorCatcher,
        {},
        h(
          ChannelErrors,
          { NotFound: () => null },
          h(SyncTest, { Template: RemotePost })
        )
      )
    )
  ).toEqual(
    'Wrap components in Logux ' +
      '<ChannelErrors NotFound={Page404} AccessDenied={Page403}>'
  )
})

it('does not throw on ChannelErrors with 404 and 403', async () => {
  spyOn(console, 'error', () => {})
  expect(
    getText(
      h(
        ChannelErrors,
        { NotFound: () => null, AccessDenied: () => null },
        h(SyncTest, { Template: RemotePost })
      )
    )
  ).toBe('loading')
})

it('has hook to get client', () => {
  let Test: FC = () => {
    let client = useClient()
    return h('div', {}, client.options.userId)
  }
  let client = new TestClient('10')
  expect(
    getText(
      h(ClientContext.Provider, { value: client, children: h(Test, null) })
    )
  ).toBe('10')
})

it('renders filter', async () => {
  let client = new TestClient('10')
  let renders: string[] = []
  let TestList: FC = () => {
    let posts = useFilter(LocalPost, { projectId: '1' })
    expect(posts.stores.size).toEqual(posts.list.length)
    renders.push('list')
    return h(
      // @ts-expect-error
      'ul',
      { 'data-testid': 'test' },
      posts.list.map((post, index) => {
        renders.push(post.id)
        return h('li', {}, ` ${index}:${post.title}`)
      })
    )
  }

  render(
    h(ClientContext.Provider, {
      value: client,
      children: h(ChannelErrors, { Error: () => null }, h(TestList, null))
    })
  )
  expect(screen.getByTestId('test').textContent).toBe('')
  expect(renders).toEqual(['list'])

  await act(async () => {
    await Promise.all([
      createSyncMap(client, LocalPost, { id: '1', projectId: '1', title: 'Y' }),
      createSyncMap(client, LocalPost, { id: '2', projectId: '2', title: 'Y' }),
      createSyncMap(client, LocalPost, { id: '3', projectId: '1', title: 'A' })
    ])
    await delay(10)
  })
  expect(screen.getByTestId('test').textContent).toBe(' 0:Y 1:A')
  expect(renders).toEqual(['list', 'list', '1', '3'])

  await act(async () => {
    await changeSyncMapById(client, LocalPost, '3', 'title', 'B')
    await delay(10)
  })
  expect(screen.getByTestId('test').textContent).toBe(' 0:Y 1:B')
  expect(renders).toEqual(['list', 'list', '1', '3', 'list', '1', '3'])

  await act(async () => {
    await changeSyncMapById(client, LocalPost, '3', 'title', 'Z')
    await delay(10)
  })
  expect(screen.getByTestId('test').textContent).toBe(' 0:Y 1:Z')
  expect(renders).toEqual([
    'list',
    'list',
    '1',
    '3',
    'list',
    '1',
    '3',
    'list',
    '1',
    '3'
  ])
})

it('recreating filter on args changes', async () => {
  let client = new TestClient('10')
  let renders: string[] = []
  let TestList: FC = () => {
    let [filter, setFilter] = useState({ projectId: '1' })
    let posts = useFilter(LocalPost, filter)
    renders.push('list')
    return h(
      'div',
      {},
      h('button', {
        'data-testid': 'change',
        'onClick': () => {
          setFilter({ projectId: '2' })
        }
      }),
      h(
        // @ts-expect-error
        'ul',
        { 'data-testid': 'test' },
        posts.list.map((post, index) => {
          renders.push(post.id)
          return h('li', { key: index }, ` ${index}:${post.title}`)
        })
      )
    )
  }

  render(
    h(ClientContext.Provider, {
      value: client,
      children: h(ChannelErrors, { Error: () => null }, h(TestList, null))
    })
  )
  expect(screen.getByTestId('test').textContent).toBe('')
  expect(renders).toEqual(['list'])

  await act(async () => {
    await Promise.all([
      createSyncMap(client, LocalPost, { id: '1', projectId: '1', title: 'Y' }),
      createSyncMap(client, LocalPost, { id: '2', projectId: '2', title: 'Y' }),
      createSyncMap(client, LocalPost, { id: '3', projectId: '1', title: 'A' })
    ])
    await delay(10)
  })
  expect(screen.getByTestId('test').textContent).toBe(' 0:Y 1:A')
  expect(renders).toEqual(['list', 'list', '1', '3'])

  await act(async () => {
    screen.getByTestId('change').click()
    await delay(10)
  })
  expect(renders).toEqual(['list', 'list', '1', '3', 'list'])

  await act(async () => {
    await Promise.all([
      createSyncMap(client, LocalPost, { id: '1', projectId: '1', title: 'Y' }),
      createSyncMap(client, LocalPost, { id: '2', projectId: '2', title: 'Y' }),
      createSyncMap(client, LocalPost, { id: '3', projectId: '1', title: 'A' })
    ])
    await delay(10)
  })
  await delay(10)
  expect(screen.getByTestId('test').textContent).toBe(' 0:Y')
  expect(renders).toEqual(['list', 'list', '1', '3', 'list', 'list', '2'])
})

it('renders authentication state', async () => {
  let client = new TestClient('10')
  let TestProfile: FC = () => {
    let { isAuthenticated, userId } = useAuth()
    return h(
      // @ts-expect-error
      'div',
      { 'data-testid': 'test' },
      isAuthenticated ? userId : 'loading'
    )
  }
  render(
    h(ClientContext.Provider, {
      value: client,
      children: h(ChannelErrors, { Error: () => null }, h(TestProfile, null))
    })
  )
  expect(screen.getByTestId('test').textContent).toBe('loading')

  await act(async () => {
    await client.connect()
    await delay(1)
  })
  expect(screen.getByTestId('test').textContent).toBe('10')

  await act(async () => {
    client.disconnect()
    await delay(10)
  })
  expect(screen.getByTestId('test').textContent).toBe('10')

  await act(async () => {
    client.changeUser('20', 'token')
    await client.connect()
    await delay(1)
  })
  expect(screen.getByTestId('test').textContent).toBe('20')

  await act(async () => {
    client.pair.right.send(['error', 'wrong-credentials'])
    client.pair.right.disconnect()
    await client.pair.wait()
    await delay(1)
  })
  expect(screen.getByTestId('test').textContent).toBe('loading')
})
