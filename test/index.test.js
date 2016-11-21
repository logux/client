var LocalStore = require('../local-store')
var Client = require('../client')
var index = require('../')

it('has LocalStore class', function () {
  expect(index.LocalStore).toBe(LocalStore)
})

it('has LocalStore class', function () {
  expect(index.Client).toBe(Client)
})
