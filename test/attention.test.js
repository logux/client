let { LoguxError, TestPair } = require('@logux/core')

let CrossTabClient = require('../cross-tab-client')
let attention = require('../attention')

let nextHidden
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

async function createClient () {
  document.title = 'title'

  let pair = new TestPair()
  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: false
  })

  client.node.catch(() => { })
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
  client.node.emitter.emit('error', new Error('test'))
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
  client.node.emitter.emit('error', new LoguxError('timeout'))
  expect(document.title).toEqual('title')
})

it('sets old title when user open a tab', async () => {
  let listener
  document.addEventListener = (name, callback) => {
    expect(name).toEqual('visibilitychange')
    listener = callback
  }

  let client = await createClient()
  attention(client)

  client.node.emitter.emit('error', new Error('test'))
  expect(document.title).toEqual('* title')

  nextHidden = false
  listener()
  expect(document.title).toEqual('title')
})

it('does not double title changes', async () => {
  let client = await createClient()
  attention(client)

  client.node.emitter.emit('error', new Error('test'))
  client.node.emitter.emit('error', new Error('test'))
  expect(document.title).toEqual('* title')
})

it('does not change title of visible tab', async () => {
  let client = await createClient()
  attention(client)

  nextHidden = false
  client.node.emitter.emit('error', new Error('test'))
  expect(document.title).toEqual('title')
})
