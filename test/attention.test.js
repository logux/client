var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var attention = require('../attention')

function createSync () {
  var pair = new TestPair()
  return new BaseSync('server', TestTime.getLog(), pair.left)
}

function createTest () {
  var sync = createSync()

  var pair = sync.connection.pair
  pair.leftSync = sync
  return pair.left.connect().then(function () {
    return {
      test: attention(pair.leftSync),
      pair: pair
    }
  })
}

function wait (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

it('throws an error on empty sync parameter', function () {
  expect(attention).toThrow()
})

it('checks sync parameter as instance of BaseSync', function () {
  function wrongSync () {
    attention({})
  }

  expect(wrongSync).toThrow()
})

it('throws an error on wrong sync property', function () {
  function wrongSync () {
    attention({sync: {}})
  }

  expect(wrongSync).toThrow()
})

it('checks sync property as instance of BaseSync', function () {
  function wrongSync () {
    attention({sync: createSync()})
  }

  expect(wrongSync).not.toThrow()
})

it('returns unbind function', function () {
  function createWithSyncProperty () {
    attention(createSync())
  }

  expect(createWithSyncProperty).toBeInstanceOf(Function)
})

it('allows to miss timeout error', function () {
  document.title = 'title'

  return createTest().then(function (result) {
    var pair = result.pair

    pair.leftSync.catch(function () {
    })

    var error = new Error({type: 'timeout'})
    pair.left.emitter.emit('error', error)

    expect(document.title).toBe('title*')
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
    Object.defineProperty(document, 'hidden', {
      get: function () {
        return false
      }
    })
    listener()
    test()
    return wait(10)
  }).then(function () {
    expect(document.title).toBe('title')
    expect(document.removeEventListener).toBeCalled()
  })
})
