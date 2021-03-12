import { TestTime, ServerNode, parseId } from '@logux/core'
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
    this.log.on('preadd', (action, meta) => {
      if (this.resenders[action.type]) {
        let channels = this.resenders[action.type](action, meta)
        if (typeof channels === 'string') channels = [channels]
        meta.channels = channels
      }
    })
    this.log.on('add', (action, meta) => {
      if (meta.id.includes(' server:')) return
      if (this.frozen) {
        this.deferred.push([action, meta])
      } else {
        this.process(action, meta)
      }
    })
  }

  connect(nodeId, connection) {
    let node = new ServerNode('server:id', this.log, connection, {
      outFilter: async (action, meta) => {
        if (meta.channels) {
          return meta.channels.some(channel => {
            let nodes = this.subscriptions[channel] || {}
            return !!nodes[nodeId]
          })
        }
        if (meta.nodes) {
          return meta.nodes.includes(nodeId)
        }
        return (
          !action.type.startsWith('logux/') && !meta.channels && !meta.nodes
        )
      },
      async inMap(action, meta) {
        return [action, { ...meta, subprotocol: node.remoteSubprotocol }]
      },
      async outMap(action, meta) {
        let cleaned = {}
        for (let i in meta) {
          if (i !== 'nodes' && i !== 'channels') cleaned[i] = meta[i]
        }
        return [action, cleaned]
      }
    })
    node.on('state', () => {
      if (node.state === 'disconnected' && nodeId) {
        for (let channel in this.subscriptions) {
          delete this.subscriptions[channel][nodeId]
        }
      }
    })
  }

  undoNext(reason, extra) {
    this.undo.push([reason || 'error', extra || {}])
  }

  undoAction(action, reason, extra) {
    this.bad[stringify(action)] = [reason || 'error', extra || {}]
  }

  onChannel(channel, response) {
    this.channels[channel] = response
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

  resend(type, resend) {
    this.resenders[type] = resend
  }

  sendUndo(action, meta, record) {
    if (!record) return false
    let [reason, extra] = record
    this.log.add(
      { type: 'logux/undo', id: meta.id, reason, action, ...extra },
      { nodes: [parseId(meta.id).nodeId] }
    )
    return true
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
      this.subscriptions[action.channel][nodeId] = true
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
      if (
        this.subscriptions[action.channel] &&
        this.subscriptions[action.channel][nodeId]
      ) {
        delete this.subscriptions[action.channel][nodeId]
      } else {
        // istanbul ignore next
        throw new Error(
          `Client was not subscribed to ${action.channel} ` +
            'but it try to unsubscribe from it'
        )
      }
    }
    this.log.add({ type: 'logux/processed', id }, { nodes })
  }
}
