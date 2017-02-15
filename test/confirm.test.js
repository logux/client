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

beforeEach(function () {
  window.onbeforeunload = jest.fn()
})

afterEach(function () {
  delete window.onbeforeunload
})

it('confirms close', function () {
  return createTest().then(function (test) {
    confirm(test.leftSync, 'test warning')

    test.leftSync.setState('wait')

    expect(test.leftSync.state).toBe('wait')
    expect(window.onbeforeunload()).toEqual('test warning')

    test.leftSync.setState('sending')

    var e = 'test window.onbeforeunload event'
    expect(test.leftSync.state).toBe('sending')
    expect(window.onbeforeunload(e)).toEqual('test warning')
  })
})

it('confirms close from sync property', function () {
  return createTest().then(function (test) {
    confirm({ sync: test.leftSync }, 'test warning')

    test.leftSync.setState('wait')

    expect(test.leftSync.state).toBe('wait')
    expect(window.onbeforeunload()).toEqual('test warning')
  })
})

it('does not confirm on synchronized state', function () {
  return createTest().then(function (test) {
    confirm(test.leftSync, 'test warning')

    test.leftSync.setState('synchronized')

    expect(test.leftSync.state).toBe('synchronized')
    expect(window.onbeforeunload()).toEqual(undefined)
  })
})

it('returns unbind function', function () {
  return createTest().then(function (test) {
    var unbind = confirm(test.leftSync, 'test warning')
    unbind()

    test.leftSync.setState('wait')

    expect(test.leftSync.state).toBe('wait')
    expect(window.onbeforeunload()).toEqual(undefined)
  })
})
