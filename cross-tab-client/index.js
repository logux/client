import { actionEvents, LoguxError } from '@logux/core'

import { Client } from '../client/index.js'

function storageKey(client, name) {
  return client.options.prefix + ':' + client.options.userId + ':' + name
}

function sendToTabs(client, event, data) {
  if (!client.isLocalStorage) return
  let key = storageKey(client, event)
  let json = JSON.stringify(data)
  try {
    localStorage.setItem(key, json)
  } catch (e) {
    console.error(e)
    client.isLocalStorage = false
    client.role = 'leader'
    client.emitter.emit('role')
    if (client.autoconnect) client.node.connection.connect()
  }
}

function compareSubprotocols(left, right) {
  let leftParts = left.split('.')
  let rightParts = right.split('.')
  for (let i = 0; i < 3; i++) {
    let leftNumber = parseInt(leftParts[i] || 0)
    let rightNumber = parseInt(rightParts[i] || 0)
    if (leftNumber > rightNumber) {
      return 1
    } else if (leftNumber < rightNumber) {
      return -1
    }
  }
  return 0
}

function setState(client, state) {
  client.state = state
  client.emitter.emit('state')
  sendToTabs(client, 'state', client.state)
}

function isMemory(store) {
  return Array.isArray(store.entries) && Array.isArray(store.added)
}

export class CrossTabClient extends Client {
  constructor(opts = {}) {
    super(opts)
    this.leaderState = this.node.state
    this.role = 'follower'

    this.node.on('state', () => {
      if (this.role === 'leader') {
        setState(this, this.node.state)
      }
    })

    this.log.on('add', (action, meta) => {
      actionEvents(this.emitter, 'add', action, meta)
      if (meta.tab !== this.tabId) {
        sendToTabs(this, 'add', [this.tabId, action, meta])
      }
    })
    this.log.on('clean', (action, meta) => {
      actionEvents(this.emitter, 'clean', action, meta)
    })

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', e => this.onStorage(e))
      window.addEventListener('unload', e => this.onUnload(e))
    }

    if (this.isLocalStorage) {
      let subprotocolKey = storageKey(this, 'subprotocol')
      if (localStorage.getItem(subprotocolKey) !== this.options.subprotocol) {
        sendToTabs(this, 'subprotocol', this.options.subprotocol)
      }
    }
  }

  changeUser(userId, token) {
    sendToTabs(this, 'user', [this.tabId, userId])
    super.changeUser(userId, token)
  }

  clean() {
    if (this.isLocalStorage) {
      localStorage.removeItem(storageKey(this, 'add'))
      localStorage.removeItem(storageKey(this, 'state'))
      localStorage.removeItem(storageKey(this, 'client'))
    }
    return super.clean()
  }

  destroy() {
    super.destroy()
    this.role = 'follower'
    this.emitter.emit('role')
    if (this.unlead) this.unlead()
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('storage', this.onStorage)
    }
  }

  getClientId() {
    let key = storageKey(this, 'client')
    if (!this.isLocalStorage) {
      return super.getClientId()
    } else if (localStorage.getItem(key)) {
      return localStorage.getItem(key)
    } else {
      let clientId = super.getClientId()
      localStorage.setItem(key, clientId)
      return clientId
    }
  }

  on(event, listener) {
    if (event === 'preadd') {
      return this.log.emitter.on(event, listener)
    } else {
      return this.emitter.on(event, listener)
    }
  }

  onStorage(e) {
    if (e.newValue === null) return

    let data
    if (e.key === storageKey(this, 'add')) {
      data = JSON.parse(e.newValue)
      if (data[0] !== this.tabId) {
        let action = data[1]
        let meta = data[2]
        if (!meta.tab || meta.tab === this.tabId) {
          if (isMemory(this.log.store)) {
            this.log.store.add(action, meta)
          }
          actionEvents(this.emitter, 'add', action, meta)
          if (this.role === 'leader') {
            this.node.onAdd(action, meta)
          }
        }
      }
    } else if (e.key === storageKey(this, 'state')) {
      let state = JSON.parse(localStorage.getItem(e.key))
      if (this.leaderState !== state) {
        this.leaderState = state
        this.emitter.emit('state')
      }
    } else if (e.key === storageKey(this, 'user')) {
      data = JSON.parse(e.newValue)
      if (data[0] !== this.tabId) {
        this.emitter.emit('user', data[1])
      }
    } else if (e.key === storageKey(this, 'subprotocol')) {
      let other = JSON.parse(e.newValue)
      let compare = compareSubprotocols(this.options.subprotocol, other)
      if (compare === 1) {
        sendToTabs(this, 'subprotocol', this.options.subprotocol)
      } else if (compare === -1) {
        let err = new LoguxError(
          'wrong-subprotocol',
          { supported: other, used: this.options.subprotocol },
          true
        )
        this.node.emitter.emit('error', err)
      }
    }
  }

  start(connect = true) {
    this.autoconnect = connect
    this.cleanPrevActions()

    if (
      typeof navigator === 'undefined' ||
      !navigator.locks ||
      !this.isLocalStorage
    ) {
      this.role = 'leader'
      this.emitter.emit('role')
      if (connect) this.node.connection.connect()
      return
    }

    let json = localStorage.getItem(storageKey(this, 'state'))
    if (json && json !== null && json !== '"disconnected"') {
      this.state = JSON.parse(json)
      this.emitter.emit('state')
    }

    navigator.locks.request('logux_leader', () => {
      this.role = 'leader'
      this.emitter.emit('role')
      if (connect) this.node.connection.connect()
      return new Promise(resolve => {
        this.unlead = resolve
      })
    })
  }

  type(type, listener, opts = {}) {
    if (opts.event === 'preadd') {
      return this.log.type(type, listener, opts)
    } else {
      let event = opts.event || 'add'
      let id = opts.id || ''
      return this.emitter.on(`${event}-${type}-${id}`, listener)
    }
  }

  set state(value) {
    this.leaderState = value
  }

  get state() {
    return this.leaderState
  }
}
