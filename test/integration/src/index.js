var LocalPair = require('logux-sync/local-pair')
var ClientSync = require('logux-sync/client-sync')
var ServerSync = require('logux-sync/server-sync')
var MemoryStore = require('logux-core/memory-store')
var Log = require('logux-core/log')
var Client = require('logux-client/client')

// Logux Status features
var log = require('../../../log')
var attention = require('../../../attention')
var confirm = require('../../../confirm')
var favicon = require('../../../favicon')

var faviconNormal = require('./favicon/normal.png')
var faviconOffline = require('./favicon/offline.png')
var faviconError = require('./favicon/error.png')

// Create LocalPair instance
// to emulate connection
var pair = new LocalPair()

// Create Logux Client instance.
var client = new Client({
  // There are some required options
  // that used to create connection instance for Logux Client

  // It's not needed
  // because connection should be overrided by LocalPair
  subprotocol: null,
  url: null,
  userId: null
})

// Override Logux Client `sync` property
// to make Logux Client work with LocalPair
client.sync = new ClientSync('client', client.log, pair.left)

// Create Logux Log for ServerSync
var serverLog = new Log({ store: new MemoryStore(), nodeId: 'server' })
// Create ServerSync instance with LocalPair connection
new ServerSync('server', serverLog, pair.right)

// Apply Logux Status features
log(client)
attention(client)
confirm(client)
favicon(client, {
  normal: faviconNormal,
  offline: faviconOffline,
  error: faviconError
})

// Toggle connection
document.getElementById('toggle-connection').onchange = function (e) {
  if (e.target.checked) {
    client.sync.connection.connect()
  } else {
    client.sync.connection.disconnect()
  }
}

// Add action
document.getElementById('add-action').onclick = function () {
  client.log.add(
    { type: 'test' },
    { reasons: ['test'] }
  )
}

// Clean actions
document.getElementById('clean-actions').onclick = function () {
  client.log.removeReason('test')
}

// Send client error after 3sec
document.getElementById('send-client-error').onclick = function () {
  setTimeout(function () {
    client.sync.syncError('wrong-format')
  }, 3000)
}

// Send server error after 3sec
document.getElementById('send-server-error').onclick = function () {
  setTimeout(function () {
    pair.right.send(['error', 'wrong-format'])
  }, 3000)
}
