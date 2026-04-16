import { BaseNode, ClientNode, LocalPair, Log, MemoryStore } from '@logux/core'

import { badgeStyles } from '../../badge/styles/index.js'
import {
  attention,
  badge,
  badgeEn,
  confirm,
  CrossTabClient,
  favicon,
  log,
  status
} from '../../index.js'
import faviconError from './error.png'
import faviconNormal from './normal.png'
import faviconOffline from './offline.png'

let pair = new LocalPair(500)

let serverLog = new Log({
  nodeId: 'server:uuid',
  store: new MemoryStore()
})
new BaseNode('server:uuid', serverLog, pair.right)

serverLog.on('add', (action, meta) => {
  if (action.type !== 'logux/processed') {
    setTimeout(async () => {
      await serverLog.add({ id: meta.id, type: 'logux/processed' })
    }, 500)
  }
})

let client = new CrossTabClient({
  server: 'wss://example.com/',
  subprotocol: location.hash.slice(1) === '2' ? 2 : 1,
  userId: '10'
})

let node = new ClientNode(client.node.localNodeId, client.log, pair.left)
node.connection.url = 'wss://example.com/'
node.emitter = client.node.emitter
client.node = node

attention(client)
confirm(client)
favicon(client, {
  error: faviconError,
  normal: faviconNormal,
  offline: faviconOffline
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

void client.log
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

void client.start()

document.querySelector('#connection').onchange = async e => {
  if (e.target.checked) {
    await client.node.connection.connect()
  } else {
    client.node.connection.disconnect()
  }
}

document.querySelector('#add').onclick = async () => {
  await client.log.add({ type: 'TICK' }, { reasons: ['tick'], sync: true })
}

document.querySelector('#clean').onclick = async () => {
  await client.log.removeReason('tick')
}

document.querySelector('#error').onclick = () => {
  setTimeout(async () => {
    await client.log.add({
      action: { type: 'TICK' },
      reason: 'error',
      type: 'logux/undo'
    })
  }, 3000)
}

document.querySelector('#denied').onclick = () => {
  setTimeout(async () => {
    await client.log.add({
      action: { type: 'TICK' },
      reason: 'denied',
      type: 'logux/undo'
    })
  }, 3000)
}

document.querySelector('#serverError').onclick = () => {
  setTimeout(() => {
    pair.right.send(['error', 'wrong-format'])
  }, 3000)
}

document.querySelector('#subprotocolError').onclick = () => {
  client.node.syncError('wrong-subprotocol', {
    supported: 3,
    used: 1
  })
}

if (client.options.subprotocol === 2) {
  document.querySelector('#subprotocolClient').disabled = true
} else {
  document.querySelector('#subprotocolClient').onclick = () => {
    window.open(location.toString() + '#2', '_blank')
  }
}
