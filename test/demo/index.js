import { MemoryStore, ClientNode, LocalPair, BaseNode, Log } from '@logux/core'

import {
  CrossTabClient,
  attention,
  badgeEn,
  confirm,
  favicon,
  status,
  badge,
  log
} from '../../index.js'
import { badgeStyles } from '../../badge/styles/index.js'
import faviconOffline from './offline.png'
import faviconNormal from './normal.png'
import faviconError from './error.png'

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
  subprotocol: location.hash.slice(1) || '1.0.0',
  userId: '10',
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
function emoji(state) {
  if (state === 'disconnected') {
    return '😴'
  } else if (state === 'connecting') {
    return '🔌'
  } else {
    return '😊'
  }
}
function role(value) {
  return value.slice(0, 1).toUpperCase()
}
function updateTitle() {
  document.title = emoji(client.state) + ' ' + role(client.role) + ' ' + count
}

client.on('state', () => {
  document.querySelector('#connection').checked = client.connected
  updateTitle()
})
client.on('role', () => {
  updateTitle()
  document.querySelector('#connection').disabled = client.role !== 'leader'
})
client.on('add', action => {
  if (action.type === 'TICK') count++
  updateTitle()
})
client.on('clean', action => {
  if (action.type === 'TICK') count--
  updateTitle()
})

client.log
  .each(action => {
    if (action.type === 'TICK') count++
  })
  .then(() => {
    updateTitle()
  })

client.on('role', () => {
  let isLeader = client.role === 'leader'
  document.all.connection.disabled = !isLeader
  document.all.disabled.style.display = isLeader ? 'none' : 'inline'
})

client.start()

document.querySelector('#connection').onchange = e => {
  if (e.target.checked) {
    client.node.connection.connect()
  } else {
    client.node.connection.disconnect()
  }
}

document.querySelector('#add').onclick = () => {
  client.log.add({ type: 'TICK' }, { reasons: ['tick'], sync: true })
}

document.querySelector('#clean').onclick = () => {
  client.log.removeReason('tick')
}

document.querySelector('#error').onclick = () => {
  setTimeout(() => {
    client.log.add({
      type: 'logux/undo',
      reason: 'error',
      action: { type: 'test' }
    })
  }, 3000)
}

document.querySelector('#denied').onclick = () => {
  setTimeout(() => {
    client.log.add({ type: 'logux/undo', reason: 'denied' })
  }, 3000)
}

document.querySelector('#serverError').onclick = () => {
  setTimeout(() => {
    pair.right.send(['error', 'wrong-format'])
  }, 3000)
}

document.querySelector('#subprotocolError').onclick = () => {
  client.node.syncError('wrong-subprotocol', {
    supported: '2.x',
    used: '1.0.0'
  })
}

if (client.options.subprotocol === '1.0.1') {
  document.querySelector('#subprotocolClient').disabled = true
} else {
  document.querySelector('#subprotocolClient').onclick = () => {
    window.open(location.toString() + '#1.0.1', '_blank')
  }
}
