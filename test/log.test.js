var LoguxError = require('@logux/core').LoguxError
var TestPair = require('@logux/core').TestPair
var TestTime = require('@logux/core').TestTime

var CrossTabClient = require('../cross-tab-client')
var log = require('../log')

jest.mock('browser-supports-log-styles', function () {
  return function () {
    return true
  }
})

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

beforeAll(function () {
  jest.spyOn(console, 'error').mockImplementation(function () { })
  jest.spyOn(console, 'log').mockImplementation(function () { })
})

beforeEach(function () {
  jest.clearAllMocks()
})

it('shows connecting state URL', function () {
  return createClient().then(function (client) {
    client.node.setState('disconnected')
    log(client, { color: false })

    client.node.connected = false
    client.node.connection.url = 'ws://ya.ru'
    client.node.setState('connecting')

    expect(console.log).toBeCalledWith(
      'Logux state is connecting. ' +
      '10:1:1 is connecting to ws://ya.ru.'
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
})

it('shows server node ID', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    client.node.remoteNodeId = 'server'
    client.node.connected = true
    client.node.setState('synchronized')

    expect(console.log).toBeCalledWith(
      'Logux state is synchronized. ' +
      'Client was connected to server.'
    )

    client.node.connected = false
    client.node.setState('disconnected')
    expect(console.log).toHaveBeenLastCalledWith('Logux state is disconnected')
  })
})

it('does not shows server node ID in follower role', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    client.node.remoteNodeId = undefined
    client.node.connected = true
    client.node.setState('synchronized')

    expect(console.log).toBeCalledWith('Logux state is synchronized')
  })
})

it('shows bold server node ID', function () {
  return createClient().then(function (client) {
    log(client, { color: true })

    client.node.remoteNodeId = 'server'
    client.node.connected = true
    client.node.setState('synchronized')

    expect(console.log).toBeCalledWith(
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
})

it('shows state event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    client.node.connected = false
    client.node.emitter.emit('state')

    expect(console.log).toBeCalledWith('Logux state is connecting')
  })
})

it('shows role event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    client.node.connected = false
    client.emitter.emit('role')

    expect(console.log).toBeCalledWith('Logux tab role is leader')
  })
})

it('shows error event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    var error = new LoguxError('test')
    client.node.connection.emitter.emit('error', error)
    expect(console.error).toBeCalledWith('Logux error: test')
  })
})

it('shows colorized error event', function () {
  return createClient().then(function (client) {
    log(client, { color: true })
    var error = new LoguxError('test')
    client.node.connection.emitter.emit('error', error)
    expect(console.error).toBeCalledWith(
      '%cLogux%c error: test',
      'color:#ffa200;font-weight:bold',
      ''
    )
  })
})

it('shows server error', function () {
  return createClient().then(function (client) {
    log(client, { color: false })

    var error = new LoguxError('test', 'type', true)
    client.node.emitter.emit('clientError', error)

    expect(console.error).toBeCalledWith('Logux server sent error: test')
  })
})

it('shows bold server error', function () {
  return createClient().then(function (client) {
    log(client, { color: true })

    var error = new LoguxError('test', 'type', true)
    client.node.emitter.emit('clientError', error)

    expect(console.error).toBeCalledWith(
      '%cLogux%c server sent error: test',
      'color:#ffa200;font-weight:bold',
      ''
    )
  })
})

it('shows add and clean event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    return client.node.log.add(
      { type: 'A' }, { reasons: ['test'] }
    ).then(function () {
      expect(console.log).toBeCalledWith(
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
      return client.node.log.removeReason('test')
    }).then(function () {
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
  })
})

it('shows subscription action', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    return client.node.log.add(
      { type: 'logux/subscribe', channel: 'A' }
    ).then(function () {
      expect(console.log).toBeCalledWith('Logux subscribed to channel A')
      return client.node.log.add(
        { type: 'logux/subscribe', channel: 'A', a: 1 }
      )
    }).then(function () {
      expect(console.log).toHaveBeenLastCalledWith(
        'Logux subscribed to channel A',
        { type: 'logux/subscribe', channel: 'A', a: 1 }
      )
    })
  })
})

it('shows processed action', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    return client.node.log.add(
      { type: 'logux/processed', id: '1 10:1:1 0' }
    ).then(function () {
      expect(console.log).toBeCalledWith(
        'Logux action 1 10:1:1 0 was processed'
      )
    })
  })
})

it('shows undo action', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    return client.node.log.add(
      { type: 'logux/undo', id: '1 10:1:1 0', reason: 'error' }
    ).then(function () {
      expect(console.log).toBeCalledWith(
        'Logux action 1 10:1:1 0 was undid because of error'
      )
      return client.node.log.add(
        { type: 'logux/undo', id: '1 10:1:1 0', reason: 'error', data: 1 }
      )
    }).then(function () {
      expect(console.log).toHaveBeenLastCalledWith(
        'Logux action 1 10:1:1 0 was undid because of error',
        { type: 'logux/undo', id: '1 10:1:1 0', reason: 'error', data: 1 }
      )
    })
  })
})

it('combines add and clean event', function () {
  return createClient().then(function (client) {
    log(client, { color: false })
    return client.node.log.add({ type: 'A' }).then(function () {
      expect(console.log).toBeCalledWith(
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
        return client.node.log.removeReason('test')
      }).then(function () {
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
  })
})

it('shows add event with action and make action type bold', function () {
  return createClient().then(function (client) {
    client.node.localNodeId = 'client'
    log(client)
    return client.node.log.add({ type: 'B' }, { reasons: ['test'] })
  }).then(function () {
    expect(console.log).toBeCalledWith(
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

    var error = new LoguxError('test', 'type', true)
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
    var error = new LoguxError('test')
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
      'Logux state is disconnected'
    )

    var meta = { id: '1 10:1:1 0', reasons: ['test'] }
    client.emitter.emit('add', { type: 'A' }, meta)
    expect(console.log).lastCalledWith(
      'Logux added A action', { type: 'A' }, meta
    )
  })
})
