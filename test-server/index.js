import { parseId, ServerNode, TestTime } from '@logux/core'
import stringify from 'fast-json-stable-stringify'
import { delay } from 'nanodelay'

export class TestServer {
  constructor() {
    this.time = new TestTime()
    this.log = this.time.nextLog({ nodeId: 'server:id' })
    this.undo = []
    this.bad = {}
    this.subscriptions = {}
    this.frozen = false
    this.deferred = []
    this.channels = {}
    this.resenders = {}
    this.connected = new Set()
    this.log.on('preadd', (action, meta) => {
      if (this.resenders[action.type]) {
        let channels = this.resenders[action.type](action, meta)
        if (typeof channels === 'string') channels = [channels]
        meta.channels = channels
      }
    })
    this.log.on('add', (action, meta) => {
      if (action.type === 'logux/subscribed') {
        if (!this.subscriptions[action.channel]) {
          this.subscriptions[action.channel] = {}
        }
        for (let nodeId of meta.nodes || []) {
          if (!this.subscriptions[action.channel][nodeId]) {
            this.subscriptions[action.channel][nodeId] = []
          }
          this.subscriptions[action.channel][nodeId].push(action.filter || true)
        }
      }
      if (meta.id.includes(' server:')) return
      if (this.frozen) {
        this.deferred.push([action, meta])
      } else {
        this.process(action, meta)
      }
    })
  }

  connect(nodeId, connection) {
    this.connected.add(nodeId)
    let server = this
    let node = new ServerNode('server:id', this.log, connection, {
      onReceive(action, meta) {
        return [action, { ...meta, subprotocol: node.remoteSubprotocol }]
      },
      onSend(action, meta) {
        let access
        if (meta.channels) {
          access = meta.channels.some(channel => {
            let nodes = server.subscriptions[channel] || {}
            return !!nodes[nodeId]
          })
        } else if (meta.nodes) {
          access = meta.nodes.includes(nodeId)
        } else {
          access =
            !action.type.startsWith('logux/') && !meta.channels && !meta.nodes
        }
        if (access) {
          let cleaned = {}
          for (let i in meta) {
            if (i !== 'nodes' && i !== 'channels') cleaned[i] = meta[i]
          }
          return [action, cleaned]
        } else {
          return false
        }
      }
    })
    node.on('state', () => {
      if (node.state === 'disconnected' && nodeId) {
        this.connected.delete(nodeId)
        for (let channel in this.subscriptions) {
          delete this.subscriptions[channel][nodeId]
        }
      }
    })
  }

  async freezeProcessing(test) {
    this.frozen = true
    await test()
    this.frozen = false
    for (let [action, meta] of this.deferred) {
      this.process(action, meta)
    }
    this.deferred = []
    await delay(20)
  }

  onChannel(channel, response) {
    this.channels[channel] = response
  }

  process(action, meta) {
    let id = meta.id
    let nodeId = parseId(id).nodeId
    let nodes = [nodeId]

    if (this.sendUndo(action, meta, this.undo.shift())) return
    if (this.sendUndo(action, meta, this.bad[stringify(action)])) return

    if (action.type === 'logux/subscribe') {
      if (!this.subscriptions[action.channel]) {
        this.subscriptions[action.channel] = {}
      }
      if (!this.subscriptions[action.channel][nodeId]) {
        this.subscriptions[action.channel][nodeId] = []
      }
      this.subscriptions[action.channel][nodeId].push(action.filter || true)
      let responses = this.channels[action.channel] || []
      if (Array.isArray(responses)) {
        for (let response of responses) {
          if (Array.isArray(response)) {
            this.log.add(response[0], { nodes, ...response[1] })
          } else {
            this.log.add(response, { nodes })
          }
        }
      } else {
        this.log.add(responses, { nodes })
      }
    } else if (action.type === 'logux/unsubscribe') {
      let hasValue
      if (action.filter) {
        hasValue = it => !compareFilters(action.filter, it)
      } else {
        hasValue = it => it !== true
      }
      if (
        this.subscriptions[action.channel] &&
        this.subscriptions[action.channel][nodeId] &&
        !this.subscriptions[action.channel][nodeId].every(hasValue)
      ) {
        this.subscriptions[action.channel][nodeId] =
          this.subscriptions[action.channel][nodeId].filter(hasValue)
        if (this.subscriptions[action.channel][nodeId].length === 0) {
          delete this.subscriptions[action.channel][nodeId]
        }
      } else {
        /* c8 ignore next 8 */
        throw new Error(
          `Client was not subscribed to ${action.channel} ` +
            (action.filter
              ? `with filter ${JSON.stringify(action.filter)} `
              : '') +
            'but it tries to unsubscribe from it'
        )
      }
    }
    this.log.add({ id, type: 'logux/processed' }, { nodes })
  }

  resend(type, resend) {
    this.resenders[type] = resend
  }

  async sendAll(action, meta = {}) {
    await this.log.add(action, { ...meta, nodes: Array.from(this.connected) })
    await delay(10)
  }

  sendUndo(action, meta, record) {
    if (!record) return false
    let [reason, extra] = record
    this.log.add(
      { action, id: meta.id, reason, type: 'logux/undo', ...extra },
      { nodes: [parseId(meta.id).nodeId] }
    )
    return true
  }

  undoAction(action, reason, extra) {
    this.bad[stringify(action)] = [reason || 'error', extra || {}]
  }

  undoNext(reason, extra) {
    this.undo.push([reason || 'error', extra || {}])
  }
}

function compareFilters(first, second) {
  let firstKeys = Object.keys(first)
  return (
    firstKeys.length === Object.keys(second).length &&
    firstKeys.every(key => first[key] === second[key])
  )
}
