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

var originOnbeforeunload = window.onbeforeunload

beforeEach(function () {
  window.onbeforeunload = jest.fn()
})

afterEach(function () {
  window.onbeforeunload = originOnbeforeunload
})

it('receives state event from sync parameter and state is wait', function () {
  return createTest().then(function (test) {
    confirm(test.leftSync, 'test warning')

    test.leftSync.setState('wait')

    expect(test.leftSync.state).toBe('wait')
    expect(window.onbeforeunload()).toEqual('test warning')
  })
})

it('receives state event from sync property and state is wait', function () {
  return createTest().then(function (test) {
    confirm({ sync: test.leftSync }, 'test warning')

    test.leftSync.setState('wait')

    expect(test.leftSync.state).toBe('wait')
    expect(window.onbeforeunload()).toEqual('test warning')
  })
})

it('allows to miss state event is not wait', function () {
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
