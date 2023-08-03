import { LoguxError, TestPair } from '@logux/core'
import { afterEach, beforeAll, expect, it } from 'vitest'

import { CrossTabClient, favicon } from '../index.js'

function getFavNode(): HTMLLinkElement {
  let node = document.querySelector('link[rel~="icon"]')
  if (node === null || !(node instanceof HTMLLinkElement)) {
    throw new Error('Favicon tag was not found')
  } else {
    return node
  }
}

function getFavHref(): string {
  return getFavNode().href.replace('http://localhost', '')
}

function setFavHref(href: string): void {
  getFavNode().href = href
}

function setState(node: any, state: string): void {
  node.setState(state)
}

function emit(obj: any, event: string, ...args: any[]): void {
  obj.emitter.emit(event, ...args)
}

async function createClient(): Promise<CrossTabClient> {
  let pair = new TestPair()
  let client = new CrossTabClient({
    server: pair.left,
    subprotocol: '1.0.0',
    userId: '10'
  })

  client.node.catch(() => {})
  client.role = 'leader'

  await pair.left.connect()
  return client
}

beforeAll(() => {
  let fav = document.createElement('link')
  fav.rel = 'icon'
  fav.href = ''
  document.head.appendChild(fav)
})

afterEach(() => {
  setFavHref('')
})

it('set favicon with current state', async () => {
  let client = await createClient()
  favicon(client, {
    normal: '/default.ico',
    offline: '/offline.ico'
  })
  expect(getFavHref()).toBe('/offline.ico')
})

it('changes favicon on state event', async () => {
  getFavNode().href = '/custom.ico'
  let client = await createClient()
  favicon(client, {
    normal: '/default.ico',
    offline: '/offline.ico'
  })

  setState(client.node, 'sending')
  expect(getFavHref()).toBe('/default.ico')

  setState(client.node, 'disconnected')
  expect(getFavHref()).toBe('/offline.ico')
})

it('works without favicon tag', async () => {
  getFavNode().remove()
  let client = await createClient()
  favicon(client, { offline: '/offline.ico' })
  expect(getFavHref()).toBe('/offline.ico')

  setState(client.node, 'sending')
  expect(getFavHref()).toBe('')
})

it('uses current favicon as normal', async () => {
  getFavNode().href = '/custom.ico'
  let client = await createClient()
  favicon(client, { offline: '/offline.ico' })
  setState(client.node, 'sending')
  expect(getFavHref()).toBe('/custom.ico')
})

it('does not double favicon changes', async () => {
  let client = await createClient()
  favicon(client, { error: '/error.ico' })
  emit(client.node, 'error', new Error('test'))
  expect(getFavHref()).toBe('/error.ico')

  setFavHref('')
  emit(client.node, 'error', new Error('test'))
  expect(getFavHref()).toBe('')
})

it('uses error icon on undo', async () => {
  let client = await createClient()
  favicon(client, { error: '/error.ico' })
  await client.log.add({ reason: 'error', type: 'logux/undo' })
  expect(getFavHref()).toBe('/error.ico')
})

it('allows to miss timeout error', async () => {
  let client = await createClient()
  favicon(client, { error: '/error.ico' })
  emit(client.node, 'error', new LoguxError('timeout'))
  expect(getFavHref()).toBe('')
})

it('does not override error by offline', async () => {
  let client = await createClient()
  favicon(client, {
    error: '/error.ico',
    offline: '/offline.ico'
  })
  emit(client.node, 'error', new Error('test'))
  expect(getFavHref()).toBe('/error.ico')

  setState(client.node, 'disconnected')
  expect(getFavHref()).toBe('/error.ico')
})

it('supports cross-tab synchronization', async () => {
  let client = await createClient()
  favicon(client, {
    normal: '/default.ico',
    offline: '/offline.ico'
  })

  client.state = 'sending'
  emit(client, 'state')
  expect(getFavHref()).toBe('/default.ico')
})

it('returns unbind function', async () => {
  let client = await createClient()
  let unbind = favicon(client, { error: '/error.ico' })

  unbind()
  emit(client.node, 'error', new Error('test'))

  expect(getFavHref()).not.toBe('/error.ico')
})
