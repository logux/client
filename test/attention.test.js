var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair
var SyncError = require('logux-sync').SyncError

var attention = require('../attention')

var nextHidden
Object.defineProperty(document, 'hidden', {
  get: function () {
    if (typeof nextHidden !== 'undefined') {
      var value = nextHidden
      nextHidden = undefined
      return value
    } else {
      return true
    }
  }
})

function createTest () {
  document.title = 'title'
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

it('receives errors', function () {
  return createTest().then(function (test) {
    attention({ sync: test.leftSync })
    test.left.emitter.emit('error', new Error('test'))
    expect(document.title).toBe('* title')
  })
})

it('returns unbind function', function () {
  document.removeEventListener = jest.fn()

  return createTest().then(function (test) {
    var unbind = attention({ sync: test.leftSync })
    unbind()
    expect(document.removeEventListener).toBeCalled()
  })
})

it('allows to miss timeout error', function () {
  return createTest().then(function (test) {
    attention({ sync: test.leftSync })
    test.left.emitter.emit('error', new SyncError(test.leftSync, 'timeout'))
    expect(document.title).toBe('title')
  })
})

it('sets old title when user open a tab', function () {
  var listener
  document.addEventListener = function (name, callback) {
    expect(name).toEqual('visibilitychange')
    listener = callback
  }

  return createTest().then(function (test) {
    attention({ sync: test.leftSync })

    test.left.emitter.emit('error', new Error('test'))
    expect(document.title).toBe('* title')

    nextHidden = false
    listener()
    expect(document.title).toBe('title')
  })
})

it('does not double title changes', function () {
  return createTest().then(function (test) {
    attention({ sync: test.leftSync })

    test.leftSync.emitter.emit('error', new Error('test'))
    test.leftSync.emitter.emit('error', new Error('test'))
    expect(document.title).toBe('* title')
  })
})

it('does not change title of visible tab', function () {
  return createTest().then(function (test) {
    attention({ sync: test.leftSync })

    nextHidden = false
    test.left.emitter.emit('error', new Error('test'))
    expect(document.title).toBe('title')
  })
})
