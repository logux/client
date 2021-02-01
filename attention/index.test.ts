import { LoguxError, TestPair } from '@logux/core'
import { jest } from '@jest/globals'

import { CrossTabClient, attention } from '../index.js'

let nextHidden: boolean | undefined
Object.defineProperty(document, 'hidden', {
  get () {
    if (typeof nextHidden !== 'undefined') {
      let value = nextHidden
      nextHidden = undefined
      return value
    } else {
      return true
    }
  }
})

function emit (obj: any, event: string, ...args: any[]) {
  obj.emitter.emit(event, ...args)
}

async function createClient () {
  document.title = 'title'

  let pair = new TestPair()
  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: '10'
  })

  client.node.catch(() => {})
  client.role = 'leader'

  await pair.left.connect()
  return client
}

let originAdd = document.addEventListener
afterEach(() => {
  document.addEventListener = originAdd
})

it('receives errors', async () => {
  let client = await createClient()
  attention(client)
  emit(client.node, 'error', new Error('test'))
  expect(document.title).toEqual('* title')
})

it('receives undo', async () => {
  let client = await createClient()
  attention(client)
  client.log.add({ type: 'logux/undo', reason: 'error' })
  expect(document.title).toEqual('* title')
})

it('returns unbind function', async () => {
  jest.spyOn(document, 'removeEventListener')
  let client = await createClient()
  let unbind = attention(client)
  unbind()
  expect(document.removeEventListener).toHaveBeenCalledTimes(1)
})

it('allows to miss timeout error', async () => {
  let client = await createClient()
  attention(client)
  emit(client.node, 'error', new LoguxError('timeout'))
  expect(document.title).toEqual('title')
})

it('sets old title when user open a tab', async () => {
  let listener: undefined | (() => void)
  document.addEventListener = (name: string, callback: any) => {
    expect(name).toEqual('visibilitychange')
    listener = callback
  }

  let client = await createClient()
  attention(client)

  emit(client.node, 'error', new Error('test'))
  expect(document.title).toEqual('* title')

  nextHidden = false
  if (typeof listener === 'undefined') throw new Error('lister was not set')
  listener()
  expect(document.title).toEqual('title')
})

it('does not double title changes', async () => {
  let client = await createClient()
  attention(client)

  emit(client.node, 'error', new Error('test'))
  emit(client.node, 'error', new Error('test'))
  expect(document.title).toEqual('* title')
})

it('does not change title of visible tab', async () => {
  let client = await createClient()
  attention(client)

  nextHidden = false
  emit(client.node, 'error', new Error('test'))
  expect(document.title).toEqual('title')
})
