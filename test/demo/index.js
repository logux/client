var MemoryStore = require('logux-core/memory-store')
var ClientSync = require('logux-sync/client-sync')
var LocalPair = require('logux-sync/local-pair')
var BaseSync = require('logux-sync/base-sync')
var Client = require('logux-client/client')
var Log = require('logux-core/log')

// Logux Status features
var attention = require('../../attention')
var confirm = require('../../confirm')
var favicon = require('../../favicon')
var log = require('../../log')

var faviconNormal = require('./normal.png')
var faviconOffline = require('./offline.png')
var faviconError = require('./error.png')

var pair = new LocalPair()

var serverLog = new Log({
  store: new MemoryStore(),
  nodeId: 'server'
})
new BaseSync('server', serverLog, pair.right)

var client = new Client({
  subprotocol: '1.0.0',
  userId: 10,
  url: 'wss://example.com/'
})
client.sync = new ClientSync(client.sync.localNodeId, client.log, pair.left)

attention(client)
confirm(client)
favicon(client, {
  normal: faviconNormal,
  offline: faviconOffline,
  error: faviconError
})
log(client)

client.sync.connection.connect()

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

document.all.add.onclick = function () {
  client.log.add({ type: 'TEST' }, { reasons: ['test'] })
}

document.all.clean.onclick = function () {
  client.log.removeReason('test')
}
