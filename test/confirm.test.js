var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair
var TestTime = require('logux-core').TestTime

var confirm = require('../confirm')

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('client', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () { })
  return pair.left.connect().then(function () {
    return pair
  })
}

var beforeunloader
var originAdd = window.addEventListener
var originRemove = window.removeEventListener

beforeEach(function () {
  delete window.event
  beforeunloader = false

  window.addEventListener = jest.fn(function (name, callback) {
    expect(name).toEqual('beforeunload')
    beforeunloader = callback
  })
  window.removeEventListener = jest.fn(function (name, callback) {
    expect(name).toEqual('beforeunload')
    if (beforeunloader === callback) beforeunloader = false
  })
})
afterEach(function () {
  window.addEventListener = originAdd
  window.removeEventListener = originRemove
})

it('confirms close', function () {
  return createTest().then(function (test) {
    confirm({ sync: test.leftSync }, 'test warning')

    test.leftSync.setState('wait')
    expect(beforeunloader()).toEqual('test warning')

    test.leftSync.setState('sending')
    var e = { }
    beforeunloader(e)
    expect(e.returnValue).toEqual('test warning')

    window.event = { }
    beforeunloader()
    expect(window.event.returnValue).toEqual('test warning')
  })
})

it('has default message', function () {
  return createTest().then(function (test) {
    confirm({ sync: test.leftSync })
    test.leftSync.setState('wait')
    expect(typeof beforeunloader()).toEqual('string')
  })
})

it('does not confirm on synchronized state', function () {
  return createTest().then(function (test) {
    confirm({ sync: test.leftSync })
    test.leftSync.setState('wait')
    test.leftSync.setState('synchronized')
    expect(beforeunloader).toBeFalsy()
  })
})

it('returns unbind function', function () {
  return createTest().then(function (test) {
    var unbind = confirm({ sync: test.leftSync })
    unbind()
    test.leftSync.setState('wait')
    expect(beforeunloader).toBeFalsy()
  })
})
