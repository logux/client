var CrossTabClient = require('logux-client/cross-tab-client')
var MemoryStore = require('logux-core/memory-store')
var ClientSync = require('logux-sync/client-sync')
var LocalPair = require('logux-sync/local-pair')
var BaseSync = require('logux-sync/base-sync')
var Log = require('logux-core/log')

// Logux Status features
var attention = require('../../attention')
var confirm = require('../../confirm')
var favicon = require('../../favicon')
var badge = require('../../badge')
var log = require('../../log')

var badgeMessages = require('../../badge/en')
var badgeStyles = require('../../badge/default')

var faviconNormal = require('./normal.png')
var faviconOffline = require('./offline.png')
var faviconError = require('./error.png')

var pair = new LocalPair(500)

var serverLog = new Log({ store: new MemoryStore(), nodeId: 'server' })
new BaseSync('server', serverLog, pair.right)

var client = new CrossTabClient({
  subprotocol: '1.0.0',
  userId: 10,
  url: 'wss://example.com/'
})

var sync = new ClientSync(client.sync.localNodeId, client.log, pair.left)
sync.connection.url = 'wss://example.com/'
sync.emitter = client.sync.emitter
client.sync = sync

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
    client.sync.connection.connect()
  } else {
    client.sync.connection.disconnect()
  }
}

document.all.clientError.onclick = function () {
  setTimeout(function () {
    client.sync.syncError('wrong-format')
  }, 3000)
}

document.all.serverError.onclick = function () {
  setTimeout(function () {
    pair.right.send(['error', 'wrong-format'])
  }, 3000)
}

document.all.subprotocolError.onclick = function () {
  client.sync.syncError('wrong-protocol', { supported: [1, 0], used: [2, 0] })
}

document.all.add.onclick = function () {
  client.log.add({ type: 'TEST' }, { reasons: ['test'] })
}

document.all.clean.onclick = function () {
  client.log.removeReason('test')
}
