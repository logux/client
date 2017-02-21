var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

jest.mock('browser-supports-log-styles', function () {
  return function () {
    return true
  }
})

var log = require('../log')

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('test1', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () { })
  return pair.left.connect().then(function () {
    return pair
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
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: false })

    test.leftSync.connected = false
    test.leftSync.connection.url = 'ws://ya.ru'
    test.leftSync.setState('connecting')

    expect(console.log).toBeCalledWith(
      'Logux: state was changed to connecting. ' +
      'test1 is connecting to ws://ya.ru.'
    )
  })
})

it('shows Logux prefix with color and make state and nodeId bold', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: true })

    test.leftSync.connected = false
    test.leftSync.connection.url = 'ws://ya.ru'
    test.leftSync.setState('connecting')

    expect(console.log).toBeCalledWith(
      '%cLogux:%c state was changed to %cconnecting%c. ' +
      '%ctest1%c is connecting to %cws://ya.ru%c.',
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
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: false })

    test.leftSync.remoteNodeId = 'server'
    test.leftSync.connected = true
    test.leftSync.setState('synchronized')

    expect(console.log).toBeCalledWith(
      'Logux: state was changed to synchronized. ' +
      'Client was connected to server.'
    )

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    expect(console.log).toHaveBeenLastCalledWith(
        'Logux: state was changed to wait'
    )
  })
})

it('shows bold server node ID', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: true })

    test.leftSync.remoteNodeId = 'server'
    test.leftSync.connected = true
    test.leftSync.setState('synchronized')

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

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    expect(console.log).toHaveBeenLastCalledWith(
        '%cLogux:%c state was changed to %cwait%c',
        'color: #ffa200',
        '',
        'font-weight: bold',
        ''
    )
  })
})

it('shows state event', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: false })

    test.leftSync.connected = false
    test.leftSync.emitter.emit('state')

    expect(console.log).toBeCalledWith(
        'Logux: state was changed to disconnected'
    )
  })
})

it('shows error event', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: false })
    test.left.emitter.emit('error', new SyncError(test.leftSync, 'test'))
    expect(console.error).toBeCalledWith('Logux: error: test')
  })
})

it('shows colorized error event', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: true })
    test.left.emitter.emit('error', new SyncError(test.leftSync, 'test'))
    expect(console.error).toBeCalledWith(
        '%cLogux:%c error: test',
        'color: #ffa200',
        ''
    )
  })
})

it('shows server error', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: false })

    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('clientError', error)

    expect(console.error).toBeCalledWith('Logux: server sent error: test')
  })
})

it('shows bold server error', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: true })

    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('clientError', error)

    expect(console.error).toBeCalledWith(
        '%cLogux:%c server sent error: test',
        'color: #ffa200',
        ''
    )
  })
})

it('shows add and clean event', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: false })
    return test.leftSync.log.add({ type: 'A' }, { reasons: ['test'] })
      .then(function () {
        expect(console.log).toBeCalledWith(
          'Logux: action A was added',
          { type: 'A' },
          { id: [1, 'test1', 0], reasons: ['test'], time: 1, added: 1 }
        )
        return test.leftSync.log.removeReason('test')
      }).then(function () {
        expect(console.log).toHaveBeenLastCalledWith(
          'Logux: action A was cleaned',
          { type: 'A' },
          { id: [1, 'test1', 0], reasons: [], time: 1, added: 1 }
        )
      })
  })
})

it('shows add and clean event and make action type bold', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, { color: true })
    return test.leftSync.log.add({ type: 'A' }, { reasons: ['test'] })
      .then(function () {
        expect(console.log).toBeCalledWith(
          '%cLogux:%c action %cA%c was added',
          'color: #ffa200',
          '',
          'font-weight: bold',
          '',
          { type: 'A' },
          { id: [1, 'test1', 0], reasons: ['test'], time: 1, added: 1 }
        )
        return test.leftSync.log.removeReason('test')
      }).then(function () {
        expect(console.log).toHaveBeenLastCalledWith(
          '%cLogux:%c action %cA%c was cleaned',
          'color: #ffa200',
          '',
          'font-weight: bold',
          '',
          { type: 'A' },
          { id: [1, 'test1', 0], reasons: [], time: 1, added: 1 }
        )
      })
  })
})

it('shows add event with action and make action type bold', function () {
  return createTest().then(function (test) {
    test.leftSync.localNodeId = 'client'
    log({ sync: test.leftSync })
    return test.leftSync.log.add({ type: 'B' }, { reasons: ['test'] })
  }).then(function () {
    expect(console.log).toBeCalledWith(
      '%cLogux:%c action %cB%c was added by %ctest1%c',
      'color: #ffa200',
      '',
      'font-weight: bold',
      '',
      'font-weight: bold',
      '',
      { type: 'B' },
      { id: [1, 'test1', 0], reasons: ['test'], time: 1, added: 1 }
    )
  })
})

it('allows to disable some message types', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync }, {
      state: false,
      error: false,
      clean: false,
      color: false,
      add: false
    })

    test.leftSync.emitter.emit('state')

    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('error', error)
    test.leftSync.emitter.emit('clientError', error)

    return test.leftSync.log.add({ type: 'A' })
  }).then(function () {
    expect(console.error).not.toBeCalled()
    expect(console.log).not.toBeCalled()
  })
})

it('returns unbind function', function () {
  return createTest().then(function (test) {
    var unbind = log({ sync: test.leftSync }, { color: false })

    unbind()
    test.left.emitter.emit('error', new Error('test'))

    expect(console.error).not.toBeCalled()
  })
})
