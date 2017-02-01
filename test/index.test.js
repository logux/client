var IndexedStore = require('../indexed-store')
var Client = require('../client')
var index = require('../')

it('has IndexedStore class', function () {
  expect(index.IndexedStore).toBe(IndexedStore)
})

it('has Client class', function () {
  expect(index.Client).toBe(Client)
})
