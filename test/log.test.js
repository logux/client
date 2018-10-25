var CrossTabClient = require('../cross-tab-client')
var SyncError = require('logux-core').SyncError
var TestPair = require('logux-core').TestPair
var TestTime = require('logux-core').TestTime

jest.mock('browser-supports-log-styles', function () {
  return function () {
    return true
  }
})

var log = require('../log')

function createClient () {
  var pair = new TestPair()
  var client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: 10,
    time: new TestTime()
  })

  client.role = 'leader'
  client.node.catch(function () { })

  return pair.left.connect().then(function () {
    return client
  })
}

var originError = console.error
var originLog = console.log

beforeEach(function () {
  console.error = jest.fn()
  console.log = jest.fn()
})

afterEach(function () {
  console.error = originError
  console.log = originLog
})

it('shows connecting state URL', function () {
  return createClient().then(function (client) {
    client.node.setState('disconnected')
    log(client, { color: false })

    client.node.connected = false
    client.node.connection.url = 'ws://ya.ru'
    client.node.setState('connecting')

    expect(console.log).toBeCalledWith(
      'Logux: state was changed to connecting. ' +
      '10:test1 is connecting to ws://ya.ru.'
    )
  })
})

it('shows Logux prefix with color and make state and nodeId bold', function () {
  return createClient().then(function (client) {
    client.node.setState('disconnected')
    log(client, { color: true })

    client.node.connected = false
    client.node.connection.url = 'ws://ya.ru'
    client.node.setState('connecting')

    expect(console.log).toBeCalledWith(
      '%cLogux:%c state was changed to %cconnecting%c. ' +
      '%c10:test1%c is connecting to %cws://ya.ru%c.',
      'color: #ffa200',
      '',
      'font-weight: bold',
      '',
      'font-weight: bold',
      '',
      'font-weight: bold',
      ''
    )
  })
})

it('shows server node ID', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    client.node.remoteNodeId = 'server'
    client.node.connected = true
    client.node.setState('synchronized')

    expect(console.log).toBeCalledWith(
      'Logux: state was changed to synchronized. ' +
      'Client was connected to server.'
    )

    client.node.connected = false
    client.node.setState('disconnected')
    expect(console.log).toHaveBeenLastCalledWith(
      'Logux: state was changed to disconnected'
    )
  })
})

it('does not shows server node ID in follower role', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    client.node.remoteNodeId = undefined
    client.node.connected = true
    client.node.setState('synchronized')

    expect(console.log).toBeCalledWith(
      'Logux: state was changed to synchronized'
    )
  })
})

it('shows bold server node ID', function () {
  return createClient().then(function (client) {
    log(client, { color: true })

    client.node.remoteNodeId = 'server'
    client.node.connected = true
    client.node.setState('synchronized')

    expect(console.log).toBeCalledWith(
      '%cLogux:%c state was changed to %csynchronized%c. ' +
      'Client was connected to %cserver%c.',
      'color: #ffa200',
      '',
      'font-weight: bold',
      '',
      'font-weight: bold',
      ''
    )

    client.node.connected = false
    client.node.setState('disconnected')
    expect(console.log).toHaveBeenLastCalledWith(
      '%cLogux:%c state was changed to %cdisconnected%c',
      'color: #ffa200',
      '',
      'font-weight: bold',
      ''
    )
  })
})

it('shows state event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    client.node.connected = false
    client.node.emitter.emit('state')

    expect(console.log).toBeCalledWith(
      'Logux: state was changed to connecting'
    )
  })
})

it('shows role event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    client.node.connected = false
    client.emitter.emit('role')

    expect(console.log).toBeCalledWith(
      'Logux: tab role was changed to leader'
    )
  })
})

it('shows error event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    var error = new SyncError('test')
    client.node.connection.emitter.emit('error', error)
    expect(console.error).toBeCalledWith('Logux: error: test')
  })
})

it('shows colorized error event', function () {
  return createClient().then(function (client) {
    log(client, { color: true })
    var error = new SyncError('test')
    client.node.connection.emitter.emit('error', error)
    expect(console.error).toBeCalledWith(
      '%cLogux:%c error: test',
      'color: #ffa200',
      ''
    )
  })
})

it('shows server error', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    var error = new SyncError('test', 'type', true)
    client.node.emitter.emit('clientError', error)

    expect(console.error).toBeCalledWith('Logux: server sent error: test')
  })
})

it('shows bold server error', function () {
  return createClient().then(function (client) {
    log(client, { color: true })

    var error = new SyncError('test', 'type', true)
    client.node.emitter.emit('clientError', error)

    expect(console.error).toBeCalledWith(
      '%cLogux:%c server sent error: test',
      'color: #ffa200',
      ''
    )
  })
})

it('shows add and clean event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    return client.node.log.add({ type: 'A' }, { reasons: ['test'] })
      .then(function () {
        expect(console.log).toBeCalledWith(
          'Logux: action A was added',
          { type: 'A' },
          {
            id: '1 10:test1 0',
            subprotocol: '1.0.0',
            reasons: ['test'],
            time: 1,
            added: 1
          }
        )
        return client.node.log.removeReason('test')
      }).then(function () {
        expect(console.log).toHaveBeenLastCalledWith(
          'Logux: action A was cleaned',
          { type: 'A' },
          {
            id: '1 10:test1 0',
            subprotocol: '1.0.0',
            reasons: [],
            time: 1,
            added: 1
          }
        )
      })
  })
})

it('combines add and clean event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    return client.node.log.add({ type: 'A' }).then(function () {
      expect(console.log).toBeCalledWith(
        'Logux: action A was added and cleaned',
        { type: 'A' },
        {
          id: '1 10:test1 0',
          subprotocol: '1.0.0',
          reasons: [],
          time: 1
        }
      )
    })
  })
})

it('ignores different tab actions', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    return client.node.log.add({ type: 'A' }, { tab: 'X', reasons: ['test'] })
      .then(function () {
        expect(console.log).not.toBeCalledWith()
        return client.node.log.removeReason('test')
      }).then(function () {
        expect(console.log).not.toBeCalled()
      })
  })
})

it('ignores actions by request', function () {
  return createClient().then(function (client) {
    log(client, { ignoreActions: ['A', 'B'] })
    return Promise.all([
      client.node.log.add({ type: 'A' }, { reasons: ['test'] }),
      client.node.log.add({ type: 'B' })
    ]).then(function () {
      expect(console.log).not.toBeCalledWith()
      return client.node.log.removeReason('test')
    }).then(function () {
      expect(console.log).not.toBeCalledWith()
      return client.node.log.add({ type: 'C' })
    }).then(function () {
      expect(console.log).toBeCalled()
    })
  })
})

it('shows add and clean event and make action type bold', function () {
  return createClient().then(function (client) {
    log(client, { color: true })
    return client.node.log.add({ type: 'A' }, { reasons: ['test'] })
      .then(function () {
        expect(console.log).toBeCalledWith(
          '%cLogux:%c action %cA%c was added',
          'color: #ffa200',
          '',
          'font-weight: bold',
          '',
          { type: 'A' },
          {
            id: '1 10:test1 0',
            subprotocol: '1.0.0',
            reasons: ['test'],
            time: 1,
            added: 1
          }
        )
        return client.node.log.removeReason('test')
      }).then(function () {
        expect(console.log).toHaveBeenLastCalledWith(
          '%cLogux:%c action %cA%c was cleaned',
          'color: #ffa200',
          '',
          'font-weight: bold',
          '',
          { type: 'A' },
          {
            id: '1 10:test1 0',
            subprotocol: '1.0.0',
            reasons: [],
            time: 1,
            added: 1
          }
        )
      })
  })
})

it('shows add event with action and make action type bold', function () {
  return createClient().then(function (client) {
    client.node.localNodeId = 'client'
    log(client)
    return client.node.log.add({ type: 'B' }, { reasons: ['test'] })
  }).then(function () {
    expect(console.log).toBeCalledWith(
      '%cLogux:%c action %cB%c was added by %c10:test1%c',
      'color: #ffa200',
      '',
      'font-weight: bold',
      '',
      'font-weight: bold',
      '',
      { type: 'B' },
      {
        id: '1 10:test1 0',
        subprotocol: '1.0.0',
        reasons: ['test'],
        time: 1,
        added: 1
      }
    )
  })
})

it('allows to disable some message types', function () {
  return createClient().then(function (client) {
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

    var error = new SyncError('test', 'type', true)
    client.node.emitter.emit('error', error)
    client.node.emitter.emit('clientError', error)

    return client.node.log.add({ type: 'A' })
  }).then(function () {
    expect(console.error).not.toBeCalled()
    expect(console.log).not.toBeCalled()
  })
})

it('returns unbind function', function () {
  return createClient().then(function (client) {
    var unbind = log(client, { color: false })

    unbind()
    var error = new SyncError('test')
    client.node.connection.emitter.emit('error', error)

    expect(console.error).not.toBeCalled()
  })
})

it('supports cross-tab synchronization', function () {
  return createClient().then(function (client) {
    client.role = 'follower'
    log(client, { color: false })

    client.state = 'disconnected'
    client.emitter.emit('state')
    expect(console.log).lastCalledWith(
      'Logux: state was changed to disconnected'
    )

    var meta = { id: '1 10:test1 0', reasons: ['test'] }
    client.emitter.emit('add', { type: 'A' }, meta)
    expect(console.log).lastCalledWith(
      'Logux: action A was added', { type: 'A' }, meta
    )
  })
})
