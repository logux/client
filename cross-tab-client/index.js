import { actionEvents, LoguxError } from '@logux/core'

import { Client } from '../client/index.js'

function storageKey(client, name) {
  return client.options.prefix + ':' + client.options.userId + ':' + name
}

// localStorage keeps only strings, but actions can contain bytes. We encode
// them as Base64 in a string with `\0` prefix. Real strings with `\0` prefix
// get an extra `\0`, so encoding is lossless.
const BINARY_MARK = '\0'

function replacer(key, value) {
  if (value instanceof Uint8Array) {
    return BINARY_MARK + btoa(String.fromCharCode(...value))
  } else if (typeof value === 'string' && value[0] === BINARY_MARK) {
    return BINARY_MARK + value
  } else {
    return value
  }
}

function reviver(key, value) {
  if (typeof value !== 'string' || value[0] !== BINARY_MARK) {
    return value
  } else if (value[1] === BINARY_MARK) {
    return value.slice(1)
  } else {
    return Uint8Array.from(atob(value.slice(1)), c => c.charCodeAt(0))
  }
}

function parse(json) {
  return JSON.parse(json, reviver)
}

function sendToTabs(client, event, data) {
  if (!client.isLocalStorage) return
  let key = storageKey(client, event)
  let json = JSON.stringify(data, replacer)
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

function changeState(client, state) {
  if (client.leaderState !== state) {
    client.leaderState = state
    client.emitter.emit('state')
    return true
  }
  return false
}

function setState(client, state) {
  if (changeState(client, state)) sendToTabs(client, 'state', state)
}

function lead(client) {
  client.role = 'leader'
  client.emitter.emit('role')
  let node = client.node
  let connect = client.autoconnect && node.state === 'disconnected'
  changeState(client, connect ? 'connecting' : node.state)
  // Other followers can still keep the state of the dead leader
  sendToTabs(client, 'state', client.state)
  if (connect) {
    void Promise.resolve(node.connection.connect()).then(() => {
      // Connection can return without connecting (like `encryptActions()`
      // with a rejected secret), so `connecting` must not stay forever
      if (client.role === 'leader') setState(client, node.state)
    })
  }
  return new Promise(resolve => {
    client.unlead = resolve
  })
}

function isMemory(store) {
  return Array.isArray(store.entries) && Array.isArray(store.added)
}

export class CrossTabClient extends Client {
  set state(value) {
    this.leaderState = value
  }

  get state() {
    return this.leaderState
  }

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
      window.addEventListener('pagehide', e => this.onUnload(e))
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
    let destroying = super.destroy()
    this.role = 'follower'
    this.emitter.emit('role')
    if (this.unlead) this.unlead()
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('storage', this.onStorage)
    }
    return destroying
  }

  forceConnect() {
    if (this.state === 'disconnected') {
      if (this.role === 'leader') {
        void this.node.connection.connect()
      }
    } else {
      sendToTabs(this, 'connect', Date.now())
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
      data = parse(e.newValue)
      if (data[0] !== this.tabId) {
        let action = data[1]
        let meta = data[2]
        if (!meta.tab || meta.tab === this.tabId) {
          if (isMemory(this.log.store)) {
            void this.log.store.add([[action, meta]])
          }
          actionEvents(this.emitter, 'add', action, meta)
          if (this.role === 'leader') {
            void this.node.onAdd([[action, meta]])
          }
        }
      }
    } else if (e.key === storageKey(this, 'state')) {
      let state = parse(localStorage.getItem(e.key))
      if (this.leaderState !== state) {
        this.leaderState = state
        this.emitter.emit('state')
      }
    } else if (e.key === storageKey(this, 'user')) {
      data = parse(e.newValue)
      if (data[0] !== this.tabId) {
        this.emitter.emit('user', data[1])
      }
    } else if (e.key === storageKey(this, 'subprotocol')) {
      let other = parse(e.newValue)
      if (this.options.subprotocol > other) {
        sendToTabs(this, 'subprotocol', this.options.subprotocol)
      } else if (this.options.subprotocol < other) {
        let err = new LoguxError(
          'wrong-subprotocol',
          { supported: other, used: this.options.subprotocol },
          true
        )
        this.node.emitter.emit('error', err)
      }
    } else if (e.key === storageKey(this, 'connect')) {
      if (this.role === 'leader') this.forceConnect()
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
      if (connect) void this.node.connection.connect()
      return
    }

    // Saved state can be from a closed tab, so it is used only when we know
    // that the leader is alive. Until then we are connecting, like `Client`.
    if (connect) changeState(this, 'connecting')

    // `ifAvailable` checks the leader and takes the lock in the same step
    let lockOpts = { ifAvailable: true }
    void navigator.locks.request('logux_leader', lockOpts, lock => {
      if (lock) return lead(this)
      let json = localStorage.getItem(storageKey(this, 'state'))
      changeState(this, (json && parse(json)) || 'disconnected')
      void navigator.locks.request('logux_leader', () => lead(this))
    })
  }

  type(type, listener, opts = {}) {
    if (typeof type === 'function') type = type.type
    if (opts.event === 'preadd') {
      return this.log.type(type, listener, opts)
    } else {
      let event = opts.event || 'add'
      let id = opts.id || ''
      return this.emitter.on(`${event}-${type}-${id}`, listener)
    }
  }
}
