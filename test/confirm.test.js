var TestPair = require('@logux/core').TestPair

var CrossTabClient = require('../cross-tab-client')
var confirm = require('../confirm')

function createClient () {
  var pair = new TestPair()

  var client = new CrossTabClient({
    subprotocol: '1.0.0',
    server: pair.left,
    userId: false
  })

  client.node.catch(function () { })
  client.role = 'leader'

  return pair.left.connect().then(function () {
    return client
  })
}

var beforeunloader
beforeEach(function () {
  delete window.event
  beforeunloader = false

  jest.spyOn(window, 'addEventListener').mockImplementation(function (n, c) {
    if (n === 'beforeunload') beforeunloader = c
  })
  jest.spyOn(window, 'removeEventListener').mockImplementation(function (n, c) {
    if (n === 'beforeunload' && beforeunloader === c) {
      beforeunloader = false
    }
  })
})

it('confirms close', function () {
  var client
  return createClient().then(function (created) {
    client = created
    confirm(client)

    client.node.setState('disconnected')
    expect(beforeunloader).toBeFalsy()

    return Promise.all([
      client.log.add(
        { type: 'logux/subscribe' }, { sync: true, reasons: ['t'] }),
      client.log.add(
        { type: 'logux/unsubscribe' }, { sync: true, reasons: ['t'] })
    ])
  }).then(function () {
    expect(beforeunloader).toBeFalsy()

    return client.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    expect(beforeunloader()).toEqual('unsynced')

    client.node.setState('sending')
    var e = { }
    beforeunloader(e)
    expect(e.returnValue).toEqual('unsynced')

    window.event = { }
    beforeunloader()
    expect(window.event.returnValue).toEqual('unsynced')
  })
})

it('does not confirm on synchronized state', function () {
  var client
  return createClient().then(function (created) {
    client = created
    confirm(client)
    client.node.setState('disconnected')
    return client.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    client.node.setState('synchronized')
    expect(beforeunloader).toBeFalsy()

    client.node.setState('disconnected')
    expect(beforeunloader).toBeFalsy()
  })
})

it('does not confirm on follower tab', function () {
  var client
  return createClient().then(function (created) {
    client = created
    confirm(client)
    client.node.setState('disconnected')
    expect(beforeunloader).toBeFalsy()
    return client.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    client.role = 'follower'
    client.emitter.emit('role')
    expect(beforeunloader).toBeFalsy()
  })
})

it('returns unbind function', function () {
  var client
  return createClient().then(function (created) {
    client = created
    var unbind = confirm(client)
    unbind()
    client.node.setState('disconnected')
    expect(beforeunloader).toBeFalsy()
    return client.log.add({ type: 'A' }, { sync: true, reasons: ['t'] })
  }).then(function () {
    expect(beforeunloader).toBeFalsy()
  })
})
