var MemoryStore = require('logux-core/memory-store')
var ClientSync = require('logux-sync/client-sync')
var LocalPair = require('logux-sync/local-pair')
var BaseSync = require('logux-sync/base-sync')
var Log = require('logux-core/log')

var CrossTabClient = require('../../cross-tab-client')

var pair = new LocalPair(500)

var serverLog = new Log({
  store: new MemoryStore(),
  nodeId: 'server'
})
new BaseSync('server', serverLog, pair.right)

var client = new CrossTabClient({
  subprotocol: '1.0.0',
  userId: 10,
  url: 'wss://example.com/'
})
var old = client.sync
client.sync = new ClientSync(client.sync.localNodeId, client.log, pair.left)
client.sync.emitter = old.emitter

var count = 0
function emoji (state) {
  if (state === 'disconnected') {
    return '😴'
  } else if (state === 'connecting') {
    return '🔌'
  } else if (state === 'wait') {
    return '⏲️'
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
    client.sync.connection.connect()
  } else {
    client.sync.connection.disconnect()
  }
}

document.all.add.onclick = function () {
  client.log.add({ type: 'TICK' }, { reasons: ['tick'] })
}

document.all.clean.onclick = function () {
  client.log.removeReason('tick')
}
