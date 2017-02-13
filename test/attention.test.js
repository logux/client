var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var attention = require('../attention')

function createSync () {
  var pair = new TestPair()
  return new BaseSync('server', TestTime.getLog(), pair.left)
}

function createTest (useSyncProperty) {
  var sync = createSync()
  var pair = sync.connection.pair
  var test

  pair.leftSync = sync

  if (useSyncProperty) {
    test = attention({sync: pair.leftSync})
  } else {
    test = attention(pair.leftSync)
  }
  return pair.left.connect().then(function () {
    return {
      test: test,
      pair: pair
    }
  })
}

function wait (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

Object.defineProperty(document, 'hidden', {
  get: function () {
    return false
  }
})

it('throws an error on empty sync parameter', function () {
  expect(attention).toThrow(/Missed sync argument/)
})

it('receives errors from sync parameter', function () {
  return createTest().then(function (result) {
    var pair = result.pair
    document.title = 'title'

    pair.leftSync.catch(function () {
    })

    var error = new Error('test')
    pair.left.emitter.emit('error', error)
    expect(document.title).toBe('title*')
  })
})

it('receives errors from sync property', function () {
  return createTest(true).then(function (result) {
    var pair = result.pair
    document.title = 'title'

    pair.leftSync.catch(function () {
    })

    var error = new Error('test')
    pair.left.emitter.emit('error', error)
    expect(document.title).toBe('title*')
  })
})

it('returns unbind function', function () {
  var listener

  document.addEventListener = function (name, callback) {
    expect(name).toEqual('visibilitychange')
    listener = callback
  }
  document.removeEventListener = jest.fn()

  return createTest().then(function (result) {
    var test = result.test
    var pair = result.pair

    pair.leftSync.catch(function () {
    })

    var error = new Error('test')
    pair.left.emitter.emit('error', error)

    listener()
    expect(test).toBeInstanceOf(Function)
    test()
    return wait(10)
  }).then(function () {
    expect(document.removeEventListener).toBeCalled()
  })
})

it('allows to miss timeout error', function () {
  document.title = 'title'

  return createTest().then(function (result) {
    var pair = result.pair

    pair.leftSync.catch(function () {
    })

    function TimeoutErrorMock () {
      this.type = 'timeout'
    }

    TimeoutErrorMock.prototype = Object.create(Error.prototype)
    TimeoutErrorMock.prototype.constructor = TimeoutErrorMock

    var error = new TimeoutErrorMock()
    pair.left.emitter.emit('error', error)

    expect(document.title).toBe('title')
  })
})

it('sets old title when user open a tab', function () {
  var listener

  document.title = 'title'

  document.addEventListener = function (name, callback) {
    expect(name).toEqual('visibilitychange')
    listener = callback
  }
  document.removeEventListener = jest.fn()

  return createTest().then(function (result) {
    var test = result.test
    var pair = result.pair

    pair.leftSync.catch(function () {
    })

    var error = new Error('test')
    pair.left.emitter.emit('error', error)

    expect(document.title).toBe('title*')

    listener()
    test()
    return wait(10)
  }).then(function () {
    expect(document.title).toBe('title')
    expect(document.removeEventListener).toBeCalled()
  })
})
