let { LoguxError, TestPair } = require('@logux/core')

let { CrossTabClient, favicon } = require('..')

function getFavNode () {
  return document.querySelector('link[rel~="icon"]')
}

function getFavHref () {
  return getFavNode().href.replace('http://localhost', '')
}

function setFavHref (href) {
  getFavNode().href = href
}

async function createClient () {
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
    offline: '/offline.ico',
    normal: '/default.ico'
  })
  expect(getFavHref()).toBe('/offline.ico')
})

it('changes favicon on state event', async () => {
  getFavNode().href = '/custom.ico'
  let client = await createClient()
  favicon(client, {
    offline: '/offline.ico',
    normal: '/default.ico'
  })

  client.node.setState('sending')
  expect(getFavHref()).toBe('/default.ico')

  client.node.setState('disconnected')
  expect(getFavHref()).toBe('/offline.ico')
})

it('works without favicon tag', async () => {
  getFavNode().remove()
  let client = await createClient()
  favicon(client, { offline: '/offline.ico' })
  expect(getFavHref()).toBe('/offline.ico')

  client.node.setState('sending')
  expect(getFavHref()).toBe('')
})

it('uses current favicon as normal', async () => {
  getFavNode().href = '/custom.ico'
  let client = await createClient()
  favicon(client, { offline: '/offline.ico' })
  client.node.setState('sending')
  expect(getFavHref()).toBe('/custom.ico')
})

it('does not double favicon changes', async () => {
  let client = await createClient()
  favicon(client, { error: '/error.ico' })
  client.node.emitter.emit('error', new Error('test'))
  expect(getFavHref()).toBe('/error.ico')

  setFavHref('')
  client.node.emitter.emit('error', new Error('test'))
  expect(getFavHref()).toBe('')
})

it('uses error icon on undo', async () => {
  let client = await createClient()
  favicon(client, { error: '/error.ico' })
  await client.log.add({ type: 'logux/undo', reason: 'error' })
  expect(getFavHref()).toBe('/error.ico')
})

it('allows to miss timeout error', async () => {
  let client = await createClient()
  favicon(client, { error: '/error.ico' })
  client.node.emitter.emit('error', new LoguxError('timeout'))
  expect(getFavHref()).toBe('')
})

it('does not override error by offline', async () => {
  let client = await createClient()
  favicon(client, {
    offline: '/offline.ico',
    error: '/error.ico'
  })
  client.node.emitter.emit('error', new Error('test'))
  expect(getFavHref()).toBe('/error.ico')

  client.node.setState('disconnected')
  expect(getFavHref()).toBe('/error.ico')
})

it('supports cross-tab synchronization', async () => {
  let client = await createClient()
  favicon(client, {
    offline: '/offline.ico',
    normal: '/default.ico'
  })

  client.state = 'sending'
  client.emitter.emit('state')
  expect(getFavHref()).toBe('/default.ico')
})

it('returns unbind function', async () => {
  let client = await createClient()
  let unbind = favicon(client, { error: '/error.ico' })

  unbind()
  client.node.emitter.emit('error', new Error('test'))

  expect(getFavHref()).not.toBe('/error.ico')
})
