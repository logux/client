let {
  MemoryStore, ClientNode, LocalPair, BaseNode, Log
} = require('@logux/core')

let {
  CrossTabClient, attention, confirm, favicon, status, badge, badgeEn, log
} = require('../..')
let { badgeStyles } = require('../../badge/styles')
let faviconOffline = require('./offline.png')
let faviconNormal = require('./normal.png')
let faviconError = require('./error.png')

let pair = new LocalPair(500)

let serverLog = new Log({
  store: new MemoryStore(),
  nodeId: 'server:uuid'
})
new BaseNode('server:uuid', serverLog, pair.right)

serverLog.on('add', (action, meta) => {
  if (action.type !== 'logux/processed') {
    setTimeout(() => {
      serverLog.add({ type: 'logux/processed', id: meta.id })
    }, 500)
  }
})

let client = new CrossTabClient({
  subprotocol: '1.0.0',
  userId: 10,
  server: 'wss://example.com/'
})

let node = new ClientNode(client.node.localNodeId, client.log, pair.left)
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
badge(client, {
  messages: badgeEn,
  styles: badgeStyles
})
log(client)
status(client, s => {
  document.all.status.innerText = s
})

let count = 0
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

client.on('state', () => {
  document.all.connection.checked = client.connected
  updateTitle()
})
client.on('role', () => {
  updateTitle()
  document.all.connection.disabled = client.role !== 'leader'
})
client.on('add', action => {
  if (action.type === 'TICK') count++
  updateTitle()
})
client.on('clean', action => {
  if (action.type === 'TICK') count--
  updateTitle()
})

client.log.each(action => {
  if (action.type === 'TICK') count++
}).then(() => {
  updateTitle()
})

client.on('role', () => {
  let isLeader = client.role === 'leader'
  document.all.connection.disabled = !isLeader
  document.all.disabled.style.display = isLeader ? 'none' : 'inline'
})

client.start()

document.all.connection.onchange = e => {
  if (e.target.checked) {
    client.node.connection.connect()
  } else {
    client.node.connection.disconnect()
  }
}

document.all.add.onclick = () => {
  client.log.add({ type: 'TICK' }, { reasons: ['tick'], sync: true })
}

document.all.clean.onclick = () => {
  client.log.removeReason('tick')
}

document.all.error.onclick = () => {
  setTimeout(() => {
    client.log.add({ type: 'logux/undo', reason: 'error' })
  }, 3000)
}

document.all.denied.onclick = () => {
  setTimeout(() => {
    client.log.add({ type: 'logux/undo', reason: 'denied' })
  }, 3000)
}

document.all.serverError.onclick = () => {
  setTimeout(() => {
    pair.right.send(['error', 'wrong-format'])
  }, 3000)
}

document.all.subprotocolError.onclick = () => {
  client.node.syncError('wrong-subprotocol', {
    supported: '2.x',
    used: '1.0.0'
  })
}
