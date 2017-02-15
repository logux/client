var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair
var SyncError = require('logux-sync').SyncError

var log = require('../log')

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('client', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () { })
  return pair.left.connect().then(function () {
    return pair
  })
}

var originLog = console.log

beforeEach(function () {
  console.log = jest.fn()
})

afterEach(function () {
  console.log = originLog
})

it('receives events from sync parameter', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.left.emitter.emit('error', new Error('test'))

    expect(console.log).toBeCalled()
  })
})

it('receives events from sync property', function () {
  return createTest().then(function (test) {
    log({ sync: test.leftSync })

    test.left.emitter.emit('error', new Error('test'))

    expect(console.log).toBeCalled()
  })
})

it('receives connect event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.leftSync.emitter.emit('connect')

    expect(console.log).toBeCalled()
  })
})

it('prints url from connection', function () {
  return createTest().then(function (test) {
    test.leftSync.connection.url = 'url'
    log(test.leftSync)

    test.leftSync.emitter.emit('connect')

    expect(console.log).toBeCalled()
  })
})

it('prints url from connection.connection', function () {
  return createTest().then(function (test) {
    test.leftSync.connection.connection = { url: 'url' }
    log(test.leftSync)

    test.leftSync.emitter.emit('connect')

    expect(console.log).toBeCalled()
  })
})

it('receives state event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.leftSync.emitter.emit('state')

    expect(console.log).toBeCalled()
  })
})

it('receives error event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.left.emitter.emit('error', new Error('test'))

    expect(console.log).toBeCalled()
  })
})

it('receives clientError event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.leftSync.sendError(new SyncError(test.leftSync, 'test', 'type'))

    expect(console.log).toBeCalled()
  })
})

it('error message depends on received type and remoteNodeId', function () {
  return createTest().then(function (test) {
    test.leftSync.remoteNodeId = 'remoteNodeId'
    log(test.leftSync)

    var error = new SyncError(test.leftSync, 'test', 'type', true)
    test.left.emitter.emit('error', error)

    expect(console.log).toBeCalled()
  })
})

it('receives log server add and clean event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)
    test.leftSync.log.add({ type: 'A' })
    expect(console.log).toBeCalled()
  })
})

it('receives log local add and clean event', function () {
  return createTest().then(function (test) {
    test.leftSync.localNodeId = 'test1'
    log(test.leftSync)
    test.leftSync.log.add({ type: 'B' })
    expect(console.log).toBeCalled()
  })
})

it('returns unbind function', function () {
  return createTest().then(function (test) {
    var unbind = log(test.leftSync)
    unbind()

    test.left.emitter.emit('error', new Error('test'))

    expect(console.log).not.toBeCalled()
  })
})
