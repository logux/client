var MemoryStore = require('logux-core/memory-store')
var ClientNode = require('logux-core/client-node')
var LocalPair = require('logux-core/local-pair')
var BaseNode = require('logux-core/base-node')
var Log = require('logux-core/log')

var CrossTabClient = require('../../cross-tab-client')

var pair = new LocalPair(500)

var serverLog = new Log({
  store: new MemoryStore(),
  nodeId: 'server:uuid'
})
new BaseNode('server:uuid', serverLog, pair.right)

var client = new CrossTabClient({
  subprotocol: '1.0.0',
  userId: 10,
  url: 'wss://example.com/'
})
var old = client.node
client.node = new ClientNode(client.node.localNodeId, client.log, pair.left)
client.node.emitter = old.emitter

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

client.start()

document.all.connection.onchange = function (e) {
  if (e.target.checked) {
    client.node.connection.connect()
  } else {
    client.node.connection.disconnect()
  }
}

document.all.add.onclick = function () {
  client.log.add({ type: 'TICK' }, { reasons: ['tick'] })
}

document.all.clean.onclick = function () {
  client.log.removeReason('tick')
}
