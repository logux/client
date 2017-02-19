var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

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
    log({ sync: test.leftSync })

    test.leftSync.connected = false
    test.leftSync.connection.url = 'ws://ya.ru'
    test.leftSync.setState('connecting')

    expect(console.log).toBeCalledWith('Logux change state to connecting. ' +
      'test1 is connecting to ws://ya.ru.')
  })
})

it('shows server node ID', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync })

    test.leftSync.remoteNodeId = 'server'
    test.leftSync.connected = true
    test.leftSync.setState('synchronized')

    expect(console.log).toBeCalledWith('Logux change state to synchronized. ' +
      'Client was connected to server.')

    test.leftSync.connected = false
    test.leftSync.setState('wait')
    expect(console.log).toHaveBeenLastCalledWith('Logux change state to wait')
  })
})

it('shows state event', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync })

    test.leftSync.connected = false
    test.leftSync.emitter.emit('state')

    expect(console.log).toBeCalledWith('Logux change state to disconnected')
  })
})

it('shows error event', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync })
    test.left.emitter.emit('error', new SyncError(test.leftSync, 'test'))
    expect(console.error).toBeCalledWith('Logux error: test')
  })
})

it('shows server error', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync })

    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('clientError', error)

    expect(console.error).toBeCalledWith('Logux server sent error: test')
  })
})

it('shows add and clean event', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync })
    return test.leftSync.log.add({ type: 'A' }, { reasons: ['test'] })
      .then(function () {
        expect(console.log).toBeCalledWith(
          'Action A was added to Logux',
          { type: 'A' },
          { id: [1, 'test1', 0], reasons: ['test'], time: 1, added: 1 }
        )
        return test.leftSync.log.removeReason('test')
      }).then(function () {
        expect(console.log).toHaveBeenLastCalledWith(
          'Action A was cleaned from Logux',
          { type: 'A' },
          { id: [1, 'test1', 0], reasons: [], time: 1, added: 1 }
        )
      })
  })
})

it('shows add event with action from different node', function () {
  return createTest().then(function (test) {
    test.leftSync.localNodeId = 'client'
    log({ sync: test.leftSync })
    return test.leftSync.log.add({ type: 'B' }, { reasons: ['test'] })
  }).then(function () {
    expect(console.log).toBeCalledWith(
      'test1 added action B to Logux',
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
    var unbind = log({ sync: test.leftSync })

    unbind()
    test.left.emitter.emit('error', new Error('test'))

    expect(console.error).not.toBeCalled()
  })
})
