var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var favicon = require('../favicon')

var fav = document.createElement('link')
fav.rel = 'icon'
fav.href = ''
document.head.appendChild(fav)

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('test1', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () {})
  return pair.left.connect().then(function () {
    return pair
  })
}

afterEach(function () {
  fav.href = ''
})

it('changes favicon from sync property', function () {
  return createTest().then(function (test) {
    favicon({ sync: test.leftSync }, { error: '/error.ico' })
    test.left.emitter.emit('error', new Error('test'))
    expect(fav.href).toBe('/error.ico')
  })
})

it('changes favicon on state event', function () {
  return createTest().then(function (test) {
    favicon(test.leftSync, { online: '/online.ico', offline: '/offline.ico' })

    test.leftSync.connected = false
    test.leftSync.setState('A')
    expect(fav.href).toBe('/offline.ico')

    test.leftSync.connected = true
    test.leftSync.setState('B')
    expect(fav.href).toBe('/online.ico')
  })
})

it('does not double favicon changes', function () {
  return createTest().then(function (test) {
    favicon(test.leftSync, { error: '/error.ico' })
    test.leftSync.emitter.emit('error', new Error('test'))
    expect(fav.href).toBe('/error.ico')

    fav.href = ''
    test.leftSync.emitter.emit('error', new Error('test'))
    expect(fav.href).toBe('')
  })
})

it('allows to miss timeout error', function () {
  return createTest().then(function (test) {
    favicon(test.leftSync, { error: '/error.ico' })
    test.left.emitter.emit('error', new SyncError(test.leftSync, 'timeout'))
    expect(fav.href).toBe('')
  })
})

it('returns unbind function', function () {
  return createTest().then(function (test) {
    var unbind = favicon(test.leftSync, { error: '/error.ico' })

    unbind()
    test.left.emitter.emit('error', new Error('test'))

    expect(fav.href).not.toBe('/error.ico')
  })
})
