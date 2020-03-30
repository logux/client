let { LoguxError, TestPair, TestTime } = require('@logux/core')
let { delay } = require('nanodelay')

let { CrossTabClient, badge, badgeEn } = require('..')
let { badgeStyles } = require('./styles')

function badgeNode () {
  return document.querySelector('div')
}

function getBadgeMessage () {
  return badgeNode().childNodes[0].innerHTML
}

async function createTest (override) {
  let pair = new TestPair()
  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 1,
    time: new TestTime()
  })

  client.role = 'leader'
  client.node.catch(() => true)

  pair.client = client
  pair.leftNode = client.node

  pair.leftNode.catch(() => true)
  await pair.left.connect()
  let opts = { messages: badgeEn, styles: badgeStyles }
  for (let i in override) {
    opts[i] = override[i]
  }
  badge(client, opts)
  return pair
}

afterEach(() => {
  let node = badgeNode()
  if (node) document.body.removeChild(node)
})

it('injects base widget styles', async () => {
  await createTest()
  expect(badgeNode().style.position).toEqual('fixed')
  expect(badgeNode().childNodes[0].style.display).toEqual('table-cell')
})

it('shows synchronized state', async () => {
  let test = await createTest({ duration: 10 })

  test.leftNode.connected = true
  test.leftNode.setState('synchronized')
  expect(badgeNode().style.display).toEqual('none')

  test.leftNode.connected = false
  test.leftNode.setState('disconnected')
  await test.leftNode.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })

  test.leftNode.setState('connecting')
  test.leftNode.connected = true
  test.leftNode.setState('sending')
  test.leftNode.setState('synchronized')
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  test.leftNode.log.add({ type: 'logux/processed', id: '1 1:1:1 0' })
  await delay(1)

  expect(getBadgeMessage()).toEqual(badgeEn.synchronized)
  await delay(10)

  expect(badgeNode().style.display).toEqual('none')
})

it('shows disconnected state', async () => {
  let test = await createTest()
  test.leftNode.connected = true
  test.leftNode.setState('connected')
  test.leftNode.connected = false
  test.leftNode.setState('disconnected')
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.disconnected)
})

it('shows wait state', async () => {
  let test = await createTest()
  test.leftNode.connected = false
  test.leftNode.setState('disconnected')
  test.leftNode.setState('wait')
  await test.leftNode.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.wait)
})

it('shows sending state', async () => {
  let test = await createTest()

  test.leftNode.connected = false
  test.leftNode.setState('disconnected')
  test.leftNode.setState('connecting')
  expect(getBadgeMessage()).toEqual(badgeEn.disconnected)

  test.leftNode.connected = false
  test.leftNode.setState('wait')
  await test.leftNode.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })

  test.leftNode.setState('connecting')
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.wait)
  await delay(105)

  expect(getBadgeMessage()).toEqual(badgeEn.sending)
  test.leftNode.setState('sending')
  expect(getBadgeMessage()).toEqual(badgeEn.sending)
})

it('shows error', async () => {
  let test = await createTest()
  test.leftNode.emitter.emit('error', { type: 'any error' })
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.syncError)
})

it('shows server errors', async () => {
  let test = await createTest()
  let protocol = new LoguxError('wrong-protocol', { })
  test.leftNode.emitter.emit('error', protocol)
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.protocolError)

  let subprotocol = new LoguxError('wrong-subprotocol', { })
  test.leftNode.emitter.emit('error', subprotocol)
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.protocolError)
})

it('shows client error', async () => {
  let test = await createTest()
  let error = new LoguxError('test', 'type', true)
  test.leftNode.emitter.emit('clientError', error)

  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.syncError)
})

it('shows error undo actions', async () => {
  let test = await createTest()
  test.leftNode.log.add({ type: 'logux/undo', reason: 'error' })
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.error)
})

it('shows denied undo actions', async () => {
  let test = await createTest()
  test.leftNode.log.add({ type: 'logux/undo', reason: 'denied' })
  expect(badgeNode().style.display).toEqual('block')
  expect(badgeNode().style.backgroundImage).toEqual('url(IMAGE_MOCK)')
  expect(getBadgeMessage()).toEqual(badgeEn.denied)
})

it('supports bottom and left side of position setting', async () => {
  await createTest({ position: 'bottom-left' })
  expect(badgeNode().style.bottom).toEqual('0px')
  expect(badgeNode().style.left).toEqual('0px')
})

it('supports middle and right side of position setting', async () => {
  await createTest({ position: 'middle-right' })
  expect(badgeNode().style.top).toEqual('50%')
  expect(badgeNode().style.right).toEqual('0px')
  expect(badgeNode().style.transform).toEqual('translateY(-50%)')
})

it('supports bottom and center side of position setting', async () => {
  await createTest({ position: 'bottom-center' })
  expect(badgeNode().style.bottom).toEqual('0px')
  expect(badgeNode().style.left).toEqual('50%')
  expect(badgeNode().style.transform).toEqual('translateX(-50%)')
})

it('supports middle-center position setting', async () => {
  await createTest({ position: 'middle-center' })
  expect(badgeNode().style.top).toEqual('50%')
  expect(badgeNode().style.left).toEqual('50%')
  expect(badgeNode().style.transform).toEqual('translate(-50%, -50%)')
})

it('supports center-middle position setting', async () => {
  await createTest({ position: 'center-middle' })
  expect(badgeNode().style.top).toEqual('50%')
  expect(badgeNode().style.left).toEqual('50%')
  expect(badgeNode().style.transform).toEqual('translate(-50%, -50%)')
})

it('removes badge from DOM', () => {
  let pair = new TestPair()
  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 10,
    time: new TestTime()
  })

  let opts = { messages: badgeEn, styles: badgeStyles }
  let unbind = badge(client, opts)

  unbind()

  expect(badgeNode()).toBeNull()
  client.node.emitter.emit('error', { type: 'wrong-protocol' })
})
