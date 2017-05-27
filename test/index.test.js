var CrossTabClient = require('../cross-tab-client')
var IndexedStore = require('../indexed-store')
var Client = require('../client')
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
