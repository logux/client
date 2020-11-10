let { TestTime, ServerNode, parseId } = require('@logux/core')
let { delay } = require('nanodelay')

class TestServer {
  constructor () {
    this.time = new TestTime()
    this.log = this.time.nextLog({ nodeId: 'server:id' })
    this.undo = []
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

  connect (nodeId, connection) {
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
      async inMap (action, meta) {
        return [action, { ...meta, subprotocol: node.remoteSubprotocol }]
      },
      async outMap (action, meta) {
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

  undoNext (reason, extra) {
    this.undo.push([reason || 'error', extra || {}])
  }

  onChannel (channel, response) {
    this.channels[channel] = response
  }

  async freezeProcessing (test) {
    this.frozen = true
    await test()
    this.frozen = false
    for (let [action, meta] of this.deferred) {
      this.process(action, meta)
    }
    this.deferred = []
    await delay(10)
  }

  resend (type, resend) {
    this.resenders[type] = resend
  }

  process (action, meta) {
    let id = meta.id
    let nodeId = parseId(id).nodeId
    let nodes = [nodeId]
    if (this.undo.length > 0) {
      let [reason, extra] = this.undo.shift()
      this.log.add(
        { type: 'logux/undo', id, reason, action, ...extra },
        { nodes }
      )
      return
    }

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
      delete this.subscriptions[action.channel][nodeId]
    }
    this.log.add({ type: 'logux/processed', id }, { nodes })
  }

  keepActions () {
    this.log.on('preadd', (action, meta) => {
      meta.reasons.push('test')
    })
  }
}

module.exports = { TestServer }
