let { LoguxError, TestPair, TestTime } = require('@logux/core')

let { CrossTabClient, log } = require('..')

jest.mock('browser-supports-log-styles', () => {
  return () => true
})

async function createClient () {
  let pair = new TestPair()
  let client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 10,
    time: new TestTime()
  })

  client.role = 'leader'
  client.node.catch(() => { })

  await pair.left.connect()
  return client
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => { })
  jest.spyOn(console, 'log').mockImplementation(() => { })
})

beforeEach(() => {
  jest.clearAllMocks()
})

it('shows connecting state URL', async () => {
  let client = await createClient()
  client.node.setState('disconnected')
  log(client, { color: false })

  client.node.connected = false
  client.node.connection.url = 'ws://ya.ru'
  client.node.setState('connecting')

  expect(console.log).toHaveBeenCalledWith(
    'Logux state is connecting. ' +
    '10:1:1 is connecting to ws://ya.ru.'
  )
})

it('shows Logux prefix with color and make state and nodeId bold', async () => {
  let client = await createClient()
  client.node.setState('disconnected')
  log(client, { color: true })

  client.node.connected = false
  client.node.connection.url = 'ws://ya.ru'
  client.node.setState('connecting')

  expect(console.log).toHaveBeenCalledWith(
    '%cLogux%c state is %cconnecting%c. ' +
    '%c10:1:1%c is connecting to %cws://ya.ru%c.',
    'color:#ffa200;font-weight:bold',
    '',
    'font-weight:bold',
    '',
    'font-weight:bold',
    '',
    'font-weight:bold',
    ''
  )
})

it('shows server node ID', async () => {
  let client = await createClient()
  log(client, { color: false })

  client.node.remoteNodeId = 'server'
  client.node.connected = true
  client.node.setState('synchronized')

  expect(console.log).toHaveBeenCalledWith(
    'Logux state is synchronized. ' +
    'Client was connected to server.'
  )

  client.node.connected = false
  client.node.setState('disconnected')
  expect(console.log).toHaveBeenLastCalledWith('Logux state is disconnected')
})

it('does not shows server node ID in follower role', async () => {
  let client = await createClient()
  log(client, { color: false })

  client.node.remoteNodeId = undefined
  client.node.connected = true
  client.node.setState('synchronized')

  expect(console.log).toHaveBeenCalledWith('Logux state is synchronized')
})

it('shows bold server node ID', async () => {
  let client = await createClient()
  log(client, { color: true })

  client.node.remoteNodeId = 'server'
  client.node.connected = true
  client.node.setState('synchronized')

  expect(console.log).toHaveBeenCalledWith(
    '%cLogux%c state is %csynchronized%c. ' +
    'Client was connected to %cserver%c.',
    'color:#ffa200;font-weight:bold',
    '',
    'font-weight:bold',
    '',
    'font-weight:bold',
    ''
  )

  client.node.connected = false
  client.node.setState('disconnected')
  expect(console.log).toHaveBeenLastCalledWith(
    '%cLogux%c state is %cdisconnected%c',
    'color:#ffa200;font-weight:bold',
    '',
    'font-weight:bold',
    ''
  )
})

it('shows state event', async () => {
  let client = await createClient()
  log(client, { color: false })

  client.node.connected = false
  client.node.emitter.emit('state')

  expect(console.log).toHaveBeenCalledWith('Logux state is connecting')
})

it('shows role event', async () => {
  let client = await createClient()
  log(client, { color: false })

  client.node.connected = false
  client.emitter.emit('role')

  expect(console.log).toHaveBeenCalledWith('Logux tab role is leader')
})

it('shows error event', async () => {
  let client = await createClient()
  log(client, { color: false })
  let error = new LoguxError('test')
  client.node.connection.emitter.emit('error', error)
  expect(console.error).toHaveBeenCalledWith('Logux error: test')
})

it('shows colorized error event', async () => {
  let client = await createClient()
  log(client, { color: true })
  let error = new LoguxError('test')
  client.node.connection.emitter.emit('error', error)
  expect(console.error).toHaveBeenCalledWith(
    '%cLogux%c error: test',
    'color:#ffa200;font-weight:bold',
    ''
  )
})

it('shows server error', async () => {
  let client = await createClient()
  log(client, { color: false })

  let error = new LoguxError('test', 'type', true)
  client.node.emitter.emit('clientError', error)

  expect(console.error).toHaveBeenCalledWith('Logux server sent error: test')
})

it('shows bold server error', async () => {
  let client = await createClient()
  log(client, { color: true })

  let error = new LoguxError('test', 'type', true)
  client.node.emitter.emit('clientError', error)

  expect(console.error).toHaveBeenCalledWith(
    '%cLogux%c server sent error: test',
    'color:#ffa200;font-weight:bold',
    ''
  )
})

it('shows add and clean event', async () => {
  let client = await createClient()
  log(client, { color: false })
  await client.node.log.add({ type: 'A' }, { reasons: ['test'] })
  expect(console.log).toHaveBeenCalledWith(
    'Logux added A action',
    { type: 'A' },
    {
      id: '1 10:1:1 0',
      subprotocol: '1.0.0',
      reasons: ['test'],
      time: 1,
      added: 1
    }
  )
  await client.node.log.removeReason('test')
  expect(console.log).toHaveBeenLastCalledWith(
    'Logux cleaned A action',
    { type: 'A' },
    {
      id: '1 10:1:1 0',
      subprotocol: '1.0.0',
      reasons: [],
      time: 1,
      added: 1
    }
  )
})

it('shows subscription action', async () => {
  let client = await createClient()
  log(client, { color: false })
  await client.node.log.add({ type: 'logux/subscribe', channel: 'A' })
  expect(console.log).toHaveBeenCalledWith('Logux subscribed to channel A')
  await client.node.log.add({ type: 'logux/subscribe', channel: 'A', a: 1 })
  expect(console.log).toHaveBeenLastCalledWith(
    'Logux subscribed to channel A',
    { type: 'logux/subscribe', channel: 'A', a: 1 }
  )
})

it('shows processed action', async () => {
  let client = await createClient()
  log(client, { color: false })
  await client.node.log.add({ type: 'logux/processed', id: '1 10:1:1 0' })
  expect(console.log).toHaveBeenCalledWith(
    'Logux action 1 10:1:1 0 was processed'
  )
})

it('shows undo action', async () => {
  let client = await createClient()
  log(client, { color: false })
  await client.node.log.add(
    { type: 'logux/undo', id: '1 10:1:1 0', reason: 'error' }
  )
  expect(console.log).toHaveBeenCalledWith(
    'Logux action 1 10:1:1 0 was undid because of error'
  )
  await client.node.log.add(
    { type: 'logux/undo', id: '1 10:1:1 0', reason: 'error', data: 1 }
  )
  expect(console.log).toHaveBeenLastCalledWith(
    'Logux action 1 10:1:1 0 was undid because of error',
    { type: 'logux/undo', id: '1 10:1:1 0', reason: 'error', data: 1 }
  )
})

it('combines add and clean event', async () => {
  let client = await createClient()
  log(client, { color: false })
  await client.node.log.add({ type: 'A' })
  expect(console.log).toHaveBeenCalledWith(
    'Logux added and cleaned A action',
    { type: 'A' },
    {
      id: '1 10:1:1 0',
      subprotocol: '1.0.0',
      reasons: [],
      time: 1
    }
  )
})

it('ignores different tab actions', async () => {
  let client = await createClient()
  log(client, { color: false })
  await client.node.log.add({ type: 'A' }, { tab: 'X', reasons: ['test'] })
  expect(console.log).not.toHaveBeenCalledWith()
  await client.node.log.removeReason('test')
  expect(console.log).not.toHaveBeenCalled()
})

it('ignores actions by request', async () => {
  let client = await createClient()
  log(client, { ignoreActions: ['A', 'B'] })
  await Promise.all([
    client.node.log.add({ type: 'A' }, { reasons: ['test'] }),
    client.node.log.add({ type: 'B' })
  ])
  expect(console.log).not.toHaveBeenCalledWith()
  await client.node.log.removeReason('test')
  expect(console.log).not.toHaveBeenCalledWith()
  await client.node.log.add({ type: 'C' })
  expect(console.log).toHaveBeenCalledTimes(1)
})

it('shows add and clean event and make action type bold', async () => {
  let client = await createClient()
  log(client, { color: true })
  await client.node.log.add({ type: 'A' }, { reasons: ['test'] })
  expect(console.log).toHaveBeenCalledWith(
    '%cLogux%c added %cA%c action',
    'color:#ffa200;font-weight:bold',
    '',
    'font-weight:bold',
    '',
    { type: 'A' },
    {
      id: '1 10:1:1 0',
      subprotocol: '1.0.0',
      reasons: ['test'],
      time: 1,
      added: 1
    }
  )
  await client.node.log.removeReason('test')
  expect(console.log).toHaveBeenLastCalledWith(
    '%cLogux%c cleaned %cA%c action',
    'color:#ffa200;font-weight:bold',
    '',
    'font-weight:bold',
    '',
    { type: 'A' },
    {
      id: '1 10:1:1 0',
      subprotocol: '1.0.0',
      reasons: [],
      time: 1,
      added: 1
    }
  )
})

it('shows add event with action and make action type bold', async () => {
  let client = await createClient()
  client.node.localNodeId = 'client'
  log(client)
  await client.node.log.add({ type: 'B' }, { reasons: ['test'] })
  expect(console.log).toHaveBeenCalledWith(
    '%cLogux%c added %cB%c action from %c10:1:1%c',
    'color:#ffa200;font-weight:bold',
    '',
    'font-weight:bold',
    '',
    'font-weight:bold',
    '',
    { type: 'B' },
    {
      id: '1 10:1:1 0',
      subprotocol: '1.0.0',
      reasons: ['test'],
      time: 1,
      added: 1
    }
  )
})

it('allows to disable some message types', async () => {
  let client = await createClient()
  log(client, {
    state: false,
    error: false,
    clean: false,
    color: false,
    role: false,
    add: false
  })

  client.node.emitter.emit('state')
  client.emitter.emit('role')

  let error = new LoguxError('test', 'type', true)
  client.node.emitter.emit('error', error)
  client.node.emitter.emit('clientError', error)

  await client.node.log.add({ type: 'A' })
  expect(console.error).not.toHaveBeenCalled()
  expect(console.log).not.toHaveBeenCalled()
})

it('returns unbind function', async () => {
  let client = await createClient()
  let unbind = log(client, { color: false })

  unbind()
  let error = new LoguxError('test')
  client.node.connection.emitter.emit('error', error)

  expect(console.error).not.toHaveBeenCalled()
})

it('supports cross-tab synchronization', async () => {
  let client = await createClient()
  client.role = 'follower'
  log(client, { color: false })

  client.state = 'disconnected'
  client.emitter.emit('state')
  expect(console.log).toHaveBeenLastCalledWith(
    'Logux state is disconnected'
  )

  let meta = { id: '1 10:1:1 0', reasons: ['test'] }
  client.emitter.emit('add', { type: 'A' }, meta)
  expect(console.log).toHaveBeenLastCalledWith(
    'Logux added A action', { type: 'A' }, meta
  )
})
