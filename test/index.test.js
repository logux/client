var CrossTabClient = require('../cross-tab-client')
var IndexedStore = require('../indexed-store')
var attention = require('../attention')
var confirm = require('../confirm')
var favicon = require('../favicon')
var Client = require('../client')
var status = require('../status')
var badge = require('../badge')
var log = require('../log')
var index = require('../')

it('has CrossTabClient class', function () {
  expect(index.CrossTabClient).toBe(CrossTabClient)
})

it('has IndexedStore class', function () {
  expect(index.IndexedStore).toBe(IndexedStore)
})

it('has Client class', function () {
  expect(index.Client).toBe(Client)
})

it('has attention function', function () {
  expect(index.attention).toBe(attention)
})

it('has confirm function', function () {
  expect(index.confirm).toBe(confirm)
})

it('has log function', function () {
  expect(index.log).toBe(log)
})

it('has status function', function () {
  expect(index.status).toBe(status)
})

it('has badge function', function () {
  expect(index.badge).toBe(badge)
})

it('has favicon function', function () {
  expect(index.favicon).toBe(favicon)
})
