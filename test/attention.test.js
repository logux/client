var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair
var SyncError = require('logux-sync').SyncError

var attention = require('../attention')

Object.defineProperty(document, 'hidden', {
  get: function () {
    return false
  }
})

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('server', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () { })
  return pair.left.connect().then(function () {
    return pair
  })
}

var originAdd = document.addEventListener
var originRemove = document.removeEventListener
afterEach(function () {
  document.addEventListener = originAdd
  document.removeEventListener = originRemove
})

it('receives errors from sync parameter', function () {
  return createTest().then(function (test) {
    document.title = 'title'
    attention(test.leftSync)

    var error = new Error('test')
    test.left.emitter.emit('error', error)

    expect(document.title).toBe('title*')
  })
})

it('receives errors from sync property', function () {
  return createTest().then(function (test) {
    document.title = 'title'
    attention({ sync: test.leftSync })

    var error = new Error('test')
    test.left.emitter.emit('error', error)

    expect(document.title).toBe('title*')
  })
})

it('returns unbind function', function () {
  document.removeEventListener = jest.fn()

  return createTest().then(function (test) {
    var unbind = attention(test.leftSync)
    unbind()
    expect(document.removeEventListener).toBeCalled()
  })
})

it('allows to miss timeout error', function () {
  return createTest().then(function (test) {
    document.title = 'title'
    attention(test.leftSync)

    var error = new SyncError(test.leftSync, 'timeout')
    test.left.emitter.emit('error', error)

    expect(document.title).toBe('title')
  })
})

it('sets old title when user open a tab', function () {
  var listener

  document.addEventListener = function (name, callback) {
    expect(name).toEqual('visibilitychange')
    listener = callback
  }
  document.removeEventListener = jest.fn()

  return createTest().then(function (test) {
    document.title = 'title'
    attention(test.leftSync)

    var error = new Error('test')
    test.left.emitter.emit('error', error)

    expect(document.title).toBe('title*')
    listener()
    expect(document.title).toBe('title')
  })
})
