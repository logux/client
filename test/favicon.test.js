var SyncError = require('logux-sync').SyncError
var TestTime = require('logux-core').TestTime
var BaseSync = require('logux-sync').BaseSync
var TestPair = require('logux-sync').TestPair

var favicon = require('../favicon')

function getFavNode () {
  return document.querySelector('link[rel~="icon"]')
}

function getFavHref () {
  return getFavNode().href
}

function setFavHref (href) {
  getFavNode().href = href
}

function createTest () {
  var pair = new TestPair()
  pair.leftSync = new BaseSync('test1', TestTime.getLog(), pair.left)
  pair.leftSync.catch(function () {})
  return pair.left.connect().then(function () {
    return pair
  })
}

afterEach(function () {
  setFavHref('')
})

it('changes favicon from sync property', function () {
  return createTest().then(function (test) {
    favicon({ sync: test.leftSync }, { error: '/error.ico' })
    test.left.emitter.emit('error', new Error('test'))
    expect(getFavHref()).toBe('/error.ico')
  })
})

it('changes favicon on state event', function () {
  return createTest().then(function (test) {
    favicon(test.leftSync, { normal: '/default.ico', offline: '/offline.ico' })

    test.leftSync.connected = false
    test.leftSync.setState('A')
    expect(getFavHref()).toBe('/offline.ico')

    test.leftSync.connected = true
    test.leftSync.setState('B')
    expect(getFavHref()).toBe('/default.ico')
  })
})

it('does not double favicon changes', function () {
  return createTest().then(function (test) {
    favicon(test.leftSync, { error: '/error.ico' })
    test.leftSync.emitter.emit('error', new Error('test'))
    expect(getFavHref()).toBe('/error.ico')

    setFavHref('')
    test.leftSync.emitter.emit('error', new Error('test'))
    expect(getFavHref()).toBe('')
  })
})

it('allows to miss timeout error', function () {
  return createTest().then(function (test) {
    favicon(test.leftSync, { error: '/error.ico' })
    test.left.emitter.emit('error', new SyncError(test.leftSync, 'timeout'))
    expect(getFavHref()).toBe('')
  })
})

it('does not override error by offline', function () {
  return createTest().then(function (test) {
    favicon(test.leftSync, { offline: '/offline.ico', error: '/error.ico' })
    test.leftSync.emitter.emit('error', new Error('test'))
    expect(getFavHref()).toBe('/error.ico')

    test.leftSync.connected = false
    test.leftSync.setState('A')
    expect(getFavHref()).toBe('/error.ico')
  })
})

it('returns unbind function', function () {
  return createTest().then(function (test) {
    var unbind = favicon(test.leftSync, { error: '/error.ico' })

    unbind()
    test.left.emitter.emit('error', new Error('test'))

    expect(getFavHref()).not.toBe('/error.ico')
  })
})
