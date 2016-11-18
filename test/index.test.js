var LocalStore = require('../local-store')
var index = require('../')

it('has LocalStore', function () {
  expect(index.LocalStore).toBe(LocalStore)
})
