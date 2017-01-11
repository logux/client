var isDevelopment = require('../is-development')

function detects (base) {
  expect(isDevelopment('ws://' + base)).toBeTruthy()
  expect(isDevelopment('wss://' + base)).toBeTruthy()
  expect(isDevelopment('ws://' + base + ':1337')).toBeTruthy()
  expect(isDevelopment('ws://' + base + '/path')).toBeTruthy()
}

it('detects localhost', function () {
  detects('localhost')
  detects('127.0.0.1')
})

it('detects IP6 localhost', function () {
  detects('ip6-localhost')
  detects('::1')
})

it('detects .dev domains as development', function () {
  detects('example.dev')
  detects('a.b1.dev')
})

it('detects .local domains as development', function () {
  detects('example.local')
  detects('a.b1.local')
})

it('detects production domains', function () {
  expect(isDevelopment('ws://example.com')).toBeFalsy()
  expect(isDevelopment('wss://example.com/path')).toBeFalsy()
  expect(isDevelopment('ws://logux.devel.com')).toBeFalsy()
})
