import { TestPair } from '@logux/core'
import { delay } from 'nanodelay'

import { TestServer } from '../test-server/index.js'
import { Client } from '../client/index.js'

export class TestClient extends Client {
  constructor (userId, opts = {}) {
    let server = opts.server || new TestServer()
    let pair = new TestPair()
    super({
      subprotocol: opts.subprotocol || '0.0.0',
      attempts: 0,
      server: pair.left,
      userId,
      time: server.time
    })
    this.pair = pair
    this.server = server
  }

  connect () {
    this.server.connect(this.nodeId, this.pair.right)
    this.node.connection.connect()
    return this.node.waitFor('synchronized')
  }

  disconnect () {
    this.node.connection.disconnect()
  }

  async sent (test) {
    let actions = []
    let unbind = this.log.on('add', (action, meta) => {
      if (meta.sync && meta.id.includes(` ${this.nodeId} `)) {
        actions.push(action)
      }
    })
    await test()
    await delay(1)
    unbind()
    return actions
  }

  subscribed (channel) {
    let nodes = this.server.subscriptions[channel] || {}
    return !!nodes[this.nodeId]
  }

  keepActions () {
    this.log.on('preadd', (action, meta) => {
      meta.reasons.push('test')
    })
  }
}
