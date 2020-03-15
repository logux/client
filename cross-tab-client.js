let LoguxError = require('@logux/core/logux-error')
let merge = require('@logux/core/merge')

let Client = require('./client')

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

function areWeOutdates (client, meta) {
  if (!meta.subprotocol) return false
  if (client.node.options.subprotocol === meta.subprotocol) return false

  let id = meta.id.split(' ')[1]
  let prefix = client.clientId + ':'
  if (id.slice(0, prefix.length) !== prefix) return false

  let ourParts = client.node.options.subprotocol.split('.')
  let remoteParts = meta.subprotocol.split('.')
  // eslint-disable-next-line
  for (let i = 0; i < ourParts.length; i++) {
    let ourNumber = parseInt(ourParts[i])
    let remoteNumber = parseInt(remoteParts[i])
    if (ourNumber > remoteNumber) {
      return false
    } else if (ourNumber < remoteNumber) {
      return true
    }
  }
  return false
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
  return store.created && store.added
}

/**
 * Low-level browser API for Logux.
 *
 * Instead of {@link Client}, this class prevents conflicts
 * between Logux instances in different tabs on single browser.
 *
 * @param {object} opts Client options.
 * @param {string|Connection} opts.server Server URL.
 * @param {string} opts.subprotocol Client subprotocol version in SemVer format.
 * @param {number|string|false} opts.userId User ID. Pass `false` if no user.
 * @param {any} [opts.credentials] Client credentials for authentication.
 * @param {string} [opts.prefix="logux"] Prefix for `IndexedDB` database to run
 *                                       multiple Logux instances
 *                                       in the same browser.
 * @param {number} [opts.timeout=20000] Timeout in milliseconds
 *                                      to break connection.
 * @param {number} [opts.ping=10000] Milliseconds since last message to test
 *                                   connection by sending ping.
 * @param {Store} [opts.store] Store to save log data. `IndexedStore`
 *                             by default (if available)
 * @param {TestTime} [opts.time] Test time to test client.
 * @param {number} [opts.minDelay=1000] Minimum delay between reconnections.
 * @param {number} [opts.maxDelay=5000] Maximum delay between reconnections.
 * @param {number} [opts.attempts=Infinity] Maximum reconnection attempts.
 * @param {boolean} [opts.allowDangerousProtocol=false] Do not show warning
 *                                                      when using `ws://`
 *                                                      in production.
 *
 * @example
 * import CrossTabClient from '@logux/client/cross-tab-client'
 *
 * const userId = document.querySelector('meta[name=user]').content
 * const token = document.querySelector('meta[name=token]').content
 *
 * const client = new CrossTabClient({
 *   credentials: token.content,
 *   subprotocol: '1.0.0',
 *   server: 'wss://example.com:1337',
 *   userId: userId
 * })
 * client.start()
 *
 * @extends Client
 * @class
 */
class CrossTabClient extends Client {
  constructor (opts = { }) {
    super(opts)

    /**
     * Current tab role. Only `leader` tab connects to server. `followers` just
     * listen to events from `leader`.
     * @type {"leader"|"follower"|"candidate"}
     *
     * @example
     * app.on('role', () => {
     *   console.log('Tab role:', app.role)
     * })
     */
    this.role = 'candidate'

    this.roleTimeout = 3000 + Math.floor(Math.random() * 1000)
    this.leaderTimeout = 5000
    this.leaderPing = 2000
    this.electionDelay = 1000

    /**
     * Leader tab synchronization state. It can differs
     * from `Client#node.state` (because only the leader tab keeps connection).
     *
     * @type {"disconnected"|"connecting"|"sending"|"synchronized"}
     *
     * @example
     * client.on('state', () => {
     *   if (client.state === 'disconnected' && client.state === 'sending') {
     *     showCloseWarning()
     *   }
     * })
     */
    this.state = this.node.state

    this.node.on('state', () => {
      if (this.role === 'leader') {
        setState(this, this.node.state)
      }
    })

    this.log.on('add', (action, meta) => {
      this.emitter.emit('add', action, meta)
      if (meta.tab !== this.tabId) {
        sendToTabs(this, 'add', [this.tabId, action, meta])
      }
    })
    this.log.on('clean', (action, meta) => {
      this.emitter.emit('clean', action, meta)
    })

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', e => this.onStorage(e))
      window.addEventListener('unload', e => this.onUnload(e))
    }
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

  /**
   * Subscribe for synchronization events. It implements nanoevents API.
   * Supported events:
   *
   * * `preadd`: action is going to be added (in current tab).
   * * `add`: action has been added to log (by any tab).
   * * `clean`: action has been removed from log (by any tab).
   * * `role`: tab role has been changed.
   * * `state`: leader tab synchronization state has been changed.
   *
   * @param {"preadd"|"add"|"clean"|"role"|"state"} event The event name.
   * @param {listener} listener The listener function.
   *
   * @return {function} Unbind listener from event.
   *
   * @example
   * app.on('add', (action, meta) => {
   *   dispatch(action)
   * })
   */
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
        if (areWeOutdates(this, meta)) {
          let err = new LoguxError('wrong-subprotocol', {
            supported: meta.subprotocol,
            used: this.node.options.subprotocol
          }, true)
          this.node.emitter.emit('error', err)
        }
        if (!meta.tab || meta.tab === this.tabId) {
          if (isMemory(this.log.store)) {
            this.log.store.add(action, meta)
          }
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
      if (this.state !== state) {
        this.state = state
        this.emitter.emit('state')
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
}

/**
 * Is leader tab connected to server.
 *
 * @name connected
 * @type {boolean}
 * @memberof CrossTabClient#
 */

CrossTabClient.prototype = merge(CrossTabClient.prototype, Client.prototype)

Object.defineProperty(CrossTabClient.prototype, 'connected', {
  get: function get () {
    return this.state !== 'disconnected' && this.state !== 'connecting'
  }
})

module.exports = CrossTabClient
