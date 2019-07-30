let CrossTabClient = require('../cross-tab-client')
let attention = require('../attention')
let confirm = require('../confirm')
let favicon = require('../favicon')
let Client = require('../client')
let status = require('../status')
let badge = require('../badge')
let index = require('../')
let log = require('../log')

it('has CrossTabClient class', () => {
  expect(index.CrossTabClient).toBe(CrossTabClient)
})

it('has Client class', () => {
  expect(index.Client).toBe(Client)
})

it('has attention function', () => {
  expect(index.attention).toBe(attention)
})

it('has confirm function', () => {
  expect(index.confirm).toBe(confirm)
})

it('has log function', () => {
  expect(index.log).toBe(log)
})

it('has status function', () => {
  expect(index.status).toBe(status)
})

it('has badge function', () => {
  expect(index.badge).toBe(badge)
})

it('has favicon function', () => {
  expect(index.favicon).toBe(favicon)
})
