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

it('shows events from sync property', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync })
    test.left.emitter.emit('error', new Error('test'))
    expect(console.error).toBeCalled()
  })
})

it('shows connect event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)
    test.leftSync.remoteNodeId = 'server'
    test.leftSync.emitter.emit('connect')
    expect(console.log).toBeCalledWith('Logux test1 was connected to server')
  })
})

it('shows connect event with URL', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.leftSync.remoteNodeId = 'server'
    test.leftSync.connection.url = 'ws://ya.ru'
    test.leftSync.emitter.emit('connect')

    expect(console.log)
      .toBeCalledWith('Logux test1 was connected to server at ws://ya.ru')
  })
})

it('prints URL from connection.connection', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.leftSync.remoteNodeId = 'server'
    test.leftSync.connection.connection = { url: 'ws://ya.ru' }
    test.leftSync.emitter.emit('connect')

    expect(console.log)
      .toBeCalledWith('Logux test1 was connected to server at ws://ya.ru')
  })
})

it('shows state event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.leftSync.emitter.emit('state')

    expect(console.log).toBeCalledWith('Logux change state to disconnected')
  })
})

it('shows error event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)
    test.left.emitter.emit('error', new SyncError(test.leftSync, 'test'))
    expect(console.error).toBeCalledWith('Logux error: test')
  })
})

it('shows server error', function () {
  return createTest().then(function (test) {
    test.leftSync.remoteNodeId = 'remoteNodeId'
    log(test.leftSync)

    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.leftSync.emitter.emit('clientError', error)

    expect(console.error).toBeCalledWith('Logux server sent error: test')
  })
})

it('shows add and clean event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)
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
    log(test.leftSync)
    return test.leftSync.log.add({ type: 'B' }, { reasons: ['test'] })
  }).then(function () {
    expect(console.log).toBeCalledWith(
      'test1 added action B to Logux',
      { type: 'B' },
      { id: [1, 'test1', 0], reasons: ['test'], time: 1, added: 1 }
    )
  })
})

it('returns unbind function', function () {
  return createTest().then(function (test) {
    var unbind = log(test.leftSync)

    unbind()
    test.left.emitter.emit('error', new Error('test'))

    expect(console.error).not.toBeCalled()
  })
})
