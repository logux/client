var CrossTabClient = require('../../cross-tab-client')
var MemoryStore = require('logux-core/memory-store')
var ClientNode = require('logux-core/client-node')
var LocalPair = require('logux-core/local-pair')
var BaseNode = require('logux-core/base-node')
var Log = require('logux-core/log')

// Logux Status features
var attention = require('../../attention')
var confirm = require('../../confirm')
var favicon = require('../../favicon')
var badge = require('../../badge')
var log = require('../../log')

var badgeMessages = require('../../badge/en')
var badgeStyles = require('../../badge/default')

var faviconOffline = require('./offline.png')
var faviconNormal = require('./normal.png')
var faviconError = require('./error.png')

var pair = new LocalPair(500)

var serverLog = new Log({ store: new MemoryStore(), nodeId: 'server' })
new BaseNode('server', serverLog, pair.right)

var client = new CrossTabClient({
  subprotocol: '1.0.0',
  server: 'wss://example.com/',
  userId: 10
})

var node = new ClientNode(client.node.localNodeId, client.log, pair.left)
node.connection.url = 'wss://example.com/'
node.emitter = client.node.emitter
client.node = node

attention(client)
confirm(client)
favicon(client, {
  normal: faviconNormal,
  offline: faviconOffline,
  error: faviconError
})
badge(client, { messages: badgeMessages, styles: badgeStyles })
log(client)

client.on('role', function () {
  var isLeader = client.role === 'leader'
  document.all.connection.disabled = !isLeader
  document.all.disabled.style.display = isLeader ? 'none' : 'inline'
})

client.start()

document.all.connection.onchange = function (e) {
  if (e.target.checked) {
    client.node.connection.connect()
  } else {
    client.node.connection.disconnect()
  }
}

document.all.error.onclick = function () {
  setTimeout(function () {
    client.log.add({ type: 'logux/undo', reason: 'error' })
  }, 3000)
}

document.all.denied.onclick = function () {
  setTimeout(function () {
    client.log.add({ type: 'logux/undo', reason: 'denied' })
  }, 3000)
}

document.all.serverError.onclick = function () {
  setTimeout(function () {
    pair.right.send(['error', 'wrong-format'])
  }, 3000)
}

document.all.subprotocolError.onclick = function () {
  client.node.syncError('wrong-subprotocol', {
    supported: '2.x',
    used: '1.0.0'
  })
}

document.all.add.onclick = function () {
  client.log.add({ type: 'TEST' }, { sync: true, reasons: ['test'] })
}

document.all.clean.onclick = function () {
  client.log.removeReason('test')
}
