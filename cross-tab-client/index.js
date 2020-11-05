let { LoguxError } = require('@logux/core/logux-error')

let { Client } = require('../client')

function storageKey (client, name) {
  return client.options.prefix + ':' + client.options.userId + ':' + name
}

function sendToTabs (client, event, data) {
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
    client.node.connection.connect()
  }
}

function getLeader (client) {
  let data = localStorage.getItem(storageKey(client, 'leader'))
  let json = []
  if (typeof data === 'string') json = JSON.parse(data)
  return json
}

function leaderPing (client) {
  sendToTabs(client, 'leader', [client.tabId, Date.now()])
}

function onDeadLeader (client) {
  if (client.state !== 'disconnected') {
    setState(client, 'disconnected')
  }
  startElection(client)
}

function watchForLeader (client) {
  clearTimeout(client.watching)
  client.watching = setTimeout(() => {
    if (!isActiveLeader(client)) {
      onDeadLeader(client)
    } else {
      watchForLeader(client)
    }
  }, client.roleTimeout)
}

function compareSubprotocols (left, right) {
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

function setRole (client, role) {
  if (client.role !== role) {
    let node = client.node
    client.role = role

    clearTimeout(client.watching)
    if (role === 'leader') {
      localStorage.removeItem(storageKey(client, 'state'))
      client.leadership = setInterval(() => {
        if (!client.unloading) leaderPing(client)
      }, client.leaderPing)
      node.connection.connect()
    } else {
      clearTimeout(client.elections)
      clearInterval(client.leadership)

      if (node.state !== 'disconnected') {
        client.node.connection.disconnect()
      }
    }

    if (role === 'follower') {
      let state = 'disconnected'
      let json = localStorage.getItem(storageKey(client, 'state'))
      if (json && json !== null) state = JSON.parse(json)
      if (state !== client.state) {
        client.state = state
        client.emitter.emit('state')
      }
    }

    client.emitter.emit('role')
  }
}

function isActiveLeader (client) {
  let leader = getLeader(client)
  return leader[1] && leader[1] >= Date.now() - client.leaderTimeout
}

function startElection (client) {
  leaderPing(client)
  setRole(client, 'candidate')
  client.elections = setTimeout(() => {
    let data = getLeader(client, 'leader')
    if (data[0] === client.tabId) {
      setRole(client, 'leader')
    } else {
      setRole(client, 'follower')
      watchForLeader(client)
    }
  }, client.electionDelay)
}

function setState (client, state) {
  client.state = state
  client.emitter.emit('state')
  sendToTabs(client, 'state', client.state)
}

function isMemory (store) {
  return Array.isArray(store.entries) && Array.isArray(store.added)
}

class CrossTabClient extends Client {
  constructor (opts = {}) {
    super(opts)

    this.role = 'candidate'

    this.roleTimeout = 3000 + Math.floor(Math.random() * 1000)
    this.leaderTimeout = 5000
    this.leaderPing = 2000
    this.electionDelay = 1000

    this.leaderState = this.node.state

    this.node.on('state', () => {
      if (this.role === 'leader') {
        setState(this, this.node.state)
      }
    })

    this.log.on('add', (action, meta) => {
      this.emitter.emit(`add-${action.type}`, action, meta)
      this.emitter.emit('add', action, meta)
      if (meta.tab !== this.tabId) {
        sendToTabs(this, 'add', [this.tabId, action, meta])
      }
    })
    this.log.on('clean', (action, meta) => {
      this.emitter.emit(`clean-${action.type}`, action, meta)
      this.emitter.emit('clean', action, meta)
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

  get state () {
    return this.leaderState
  }

  set state (value) {
    this.leaderState = value
  }

  start () {
    this.cleanPrevActions()

    if (!this.isLocalStorage) {
      this.role = 'leader'
      this.emitter.emit('role')
      this.node.connection.connect()
      return
    }

    if (isActiveLeader(this)) {
      setRole(this, 'follower')
      watchForLeader(this)
    } else {
      startElection(this)
    }
  }

  destroy () {
    super.destroy()

    clearTimeout(this.watching)
    clearTimeout(this.elections)
    clearInterval(this.leadership)
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('storage', this.onStorage)
    }
  }

  clean () {
    if (this.isLocalStorage) {
      localStorage.removeItem(storageKey(this, 'add'))
      localStorage.removeItem(storageKey(this, 'state'))
      localStorage.removeItem(storageKey(this, 'client'))
      localStorage.removeItem(storageKey(this, 'leader'))
    }
    return super.clean()
  }

  changeUser (userId, token) {
    sendToTabs(this, 'user', [this.tabId, userId])
    super.changeUser(userId, token)
  }

  type (type, listener, event = 'add') {
    if (event === 'preadd') {
      return this.log.type(type, listener, event)
    } else {
      return this.emitter.on(`${event}-${type}`, listener)
    }
  }

  on (event, listener) {
    if (event === 'preadd') {
      return this.log.emitter.on(event, listener)
    } else {
      return this.emitter.on(event, listener)
    }
  }

  onStorage (e) {
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
          this.emitter.emit(`add-${action.type}`, action, meta)
          this.emitter.emit('add', action, meta)
          if (this.role === 'leader') {
            this.node.onAdd(action, meta)
          }
        }
      }
    } else if (e.key === storageKey(this, 'leader')) {
      data = JSON.parse(e.newValue)
      if (data.length === 0) {
        onDeadLeader(this)
      } else if (data[0] !== this.tabId && this.role !== 'candidate') {
        setRole(this, 'follower')
        watchForLeader(this)
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

  onUnload () {
    if (this.role === 'leader') {
      this.unloading = true
      sendToTabs(this, 'leader', [])
    }
    super.onUnload()
  }

  getClientId () {
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

  get connected () {
    return (
      this.leaderState !== 'disconnected' && this.leaderState !== 'connecting'
    )
  }
}

module.exports = { CrossTabClient }
