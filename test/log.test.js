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

it('receives state event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)

    test.leftSync.emitter.emit('state')

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

it('receives log add event', function () {
  return createTest().then(function (test) {
    log(test.leftSync)
    test.leftSync.log.add({type: 'test'})
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
