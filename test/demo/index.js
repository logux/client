var MemoryStore = require('@logux/core/memory-store')
var ClientNode = require('@logux/core/client-node')
var LocalPair = require('@logux/core/local-pair')
var BaseNode = require('@logux/core/base-node')
var Log = require('@logux/core/log')

var CrossTabClient = require('../../cross-tab-client')
var faviconOffline = require('./offline.png')
var badgeMessages = require('../../badge/en')
var faviconNormal = require('./normal.png')
var faviconError = require('./error.png')
var badgeStyles = require('../../badge/default')
var attention = require('../../attention')
var confirm = require('../../confirm')
var favicon = require('../../favicon')
var status = require('../../status')
var badge = require('../../badge')
var log = require('../../log')

var pair = new LocalPair(500)

var serverLog = new Log({
  store: new MemoryStore(),
  nodeId: 'server:uuid'
})
new BaseNode('server:uuid', serverLog, pair.right)

var client = new CrossTabClient({
  subprotocol: '1.0.0',
  userId: 10,
  server: 'wss://example.com/'
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
status(client, function (s) {
  document.all.status.innerText = s
})

var count = 0
function emoji (state) {
  if (state === 'disconnected') {
    return '😴'
  } else if (state === 'connecting') {
    return '🔌'
  } else {
    return '😊'
  }
}
function role (value) {
  return value.slice(0, 1).toUpperCase()
}
function updateTitle () {
  document.title = emoji(client.state) + ' ' +
                   role(client.role) + ' ' +
                   count
}

client.on('state', function () {
  document.all.connection.checked = client.connected
  updateTitle()
})
client.on('role', function () {
  updateTitle()
  document.all.connection.disabled = client.role !== 'leader'
})
client.on('add', function (action) {
  if (action.type === 'TICK') count++
  updateTitle()
})
client.on('clean', function (action) {
  if (action.type === 'TICK') count--
  updateTitle()
})

client.log.each(function (action) {
  if (action.type === 'TICK') count++
}).then(function () {
  updateTitle()
})

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

document.all.add.onclick = function () {
  client.log.add({ type: 'TICK' }, { reasons: ['tick'], sync: true })
}

document.all.clean.onclick = function () {
  client.log.removeReason('tick')
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
