var BrowserConnection = require('logux-sync/browser-connection')
var MemoryStore = require('logux-core/memory-store')
var ClientSync = require('logux-sync/client-sync')
var NanoEvents = require('nanoevents')
var Reconnect = require('logux-sync/reconnect')
var shortid = require('shortid/lib/build')
var Log = require('logux-core/log')

var IndexedStore = require('./indexed-store')

function storageKey (client, name) {
  return client.options.prefix + ':' + client.options.userId + ':' + name
}

function sendToTabs (client, event, data) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey(client, event), JSON.stringify(data))
}

function getLeader (client) {
  var data = localStorage.getItem(storageKey(client, 'leader'))
  var json
  if (typeof data === 'string') json = JSON.parse(data)

  if (typeof json === 'object' && json !== null && json.length === 2) {
    return json
  } else {
    return []
  }
}

function leaderPing (client) {
  sendToTabs(client, 'leader', [client.id, Date.now()])
}

function watchForLeader (client) {
  clearTimeout(client.watching)
  client.watching = setTimeout(function () {
    client.start()
  }, client.timeout)
}

function setRole (client, role) {
  if (client.role !== role) {
    var sync = client.sync
    client.role = role

    clearTimeout(client.watching)
    if (role === 'leader') {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey(client, 'state'))
      }
      client.leadership = setInterval(function () {
        leaderPing(client)
      }, 2000)
      sync.connection.connect()
    } else {
      clearTimeout(client.elections)
      clearInterval(client.leadership)

      if (sync.state !== 'disconnected' && sync.state !== 'wait') {
        client.sync.connection.disconnect()
      }
    }

    if (role === 'follower') {
      var state = 'disconnected'
      var json = localStorage.getItem(storageKey(client, 'state'))
      if (json && json !== null) state = JSON.parse(json)
      if (state !== client.state) {
        client.state = state
        client.emitter.emit('state')
      }
    }

    client.emitter.emit('role')
  }
}

/**
 * Low-level browser API for Logux.
 *
 * @param {object} options Client options.
 * @param {string} options.url Server URL.
 * @param {string} options.subprotocol Client subprotocol version
 *                                     in SemVer format.
 * @param {number|string|false} options.userId User ID. Pass `false` if no user.
 * @param {any} [options.credentials] Client credentials for authentication.
 * @param {string} [options.prefix="logux"] Prefix for `IndexedDB` database
 *                                          to run multiple Logux instances
 *                                          in the same browser.
 * @param {string|number} [options.nodeId] Unique client ID.
 *                                         Compacted UUID by default.
 * @param {number} [options.timeout=20000] Timeout in milliseconds
 *                                         to break connection.
 * @param {number} [options.ping=10000] Milliseconds since last message to test
 *                                      connection by sending ping.
 * @param {Store} [options.store] Store to save log data. `IndexedStore`
 *                                by default (if available)
 * @param {number} [options.minDelay=1000] Minimum delay between reconnections.
 * @param {number} [options.maxDelay=5000] Maximum delay between reconnections.
 * @param {number} [options.attempts=Infinity] Maximum reconnection attempts.
 * @param {bool} [options.allowDangerousProtocol=false] Do not show warning
 *                                                      when using 'ws://'
 *                                                      in production.
 *
 * @example
 * token = document.querySelector('meta[name=token]')
 *
 * import Client from 'logux-client/client'
 * const app = new Client({
 *   credentials: token.content,
 *   subprotocol: '1.0.0',
 *   url: 'wss://example.com:1337'
 * })
 * app.start()
 *
 * @class
 */
function Client (options) {
  /**
   * Client options.
   * @type {object}
   *
   * @example
   * console.log('Logux node ID is ' + app.options.nodeId)
   */
  this.options = options || { }

  if (typeof this.options.url === 'undefined') {
    throw new Error('Missed url option in Logux client')
  }
  if (typeof this.options.subprotocol === 'undefined') {
    throw new Error('Missed subprotocol option in Logux client')
  }
  if (typeof this.options.userId === 'undefined') {
    throw new Error('Missed userId option in Logux client. ' +
                    'Pass false if you have no users.')
  }

  if (typeof this.options.prefix === 'undefined') {
    this.options.prefix = 'logux'
  }

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

  this.timeout = 3000 + Math.floor(Math.random() * 1000)

  /**
   * Unique client ID. Can be used to add an action to the specific tab.
   * @type {string}
   *
   * @example
   * app.log.add(action, { tab: app.id })
   */
  this.id = shortid(0)

  var userId = this.options.userId
  if (userId) {
    userId += ':'
  } else {
    userId = ''
  }
  this.options.nodeId = userId + this.id

  var auth
  if (/^ws:\/\//.test(this.options.url) && !options.allowDangerousProtocol) {
    auth = function (cred) {
      if (typeof cred !== 'object' || cred.env !== 'development') {
        console.error(
          'Without SSL, old proxies can block WebSockets. ' +
          'Use WSS connection for Logux or set allowDangerousProtocol option.'
        )
        return Promise.resolve(false)
      }
      return Promise.resolve(true)
    }
  }

  var store = this.options.store
  if (!store) {
    if (global.indexedDB) {
      store = new IndexedStore(this.options.prefix + ':' + this.options.userId)
    } else {
      store = new MemoryStore()
    }
  }

  /**
   * Client events log.
   * @type {Log}
   *
   * @example
   * app.log.keep(customKeeper)
   */
  this.log = new Log({ store: store, nodeId: this.options.nodeId })

  var ws = new BrowserConnection(this.options.url)
  var connection = new Reconnect(ws, {
    minDelay: this.options.minDelay,
    maxDelay: this.options.maxDelay,
    attempts: this.options.attempts
  })

  /**
   * Sync instance from `logux-sync` to synchronize logs.
   * @type {ClientSync}
   *
   * @example
   * if (client.sync.state === 'synchronized')
   */
  this.sync = new ClientSync(this.options.nodeId, this.log, connection, {
    credentials: this.options.credentials,
    subprotocol: this.options.subprotocol,
    timeout: this.options.timeout,
    ping: this.options.ping,
    auth: auth
  })

  /**
   * Leader tab synchronization state. It can differs
   * from `Client#sync.state` (because only the leader tab keeps connection).
   *
   * @type {"disconnected"|"wait"|"connecting"|"sending"|"synchronized"}
   *
   * @example
   * client.on('state', () => {
   *   if (sync.state === 'wait' && sync.state === 'sending') {
   *     showCloseWarning()
   *   }
   * })
   */
  this.state = this.sync.state

  this.emitter = new NanoEvents()
  var client = this

  this.sync.on('state', function () {
    if (client.role === 'leader') {
      client.state = client.sync.state
      client.emitter.emit('state')
      sendToTabs(client, 'state', client.state)
    }
  })

  this.sync.on('debug', function (type, stack) {
    if (type === 'error') {
      console.error('Error on Logux server:\n', stack)
    }
  })
  this.log.on('add', function (action, meta) {
    client.emitter.emit('add', action, meta)
    if (meta.tab !== client.id) sendToTabs(client, 'add', [action, meta])
  })
  this.log.on('clean', function (action, meta) {
    client.emitter.emit('clean', action, meta)
    if (meta.tab !== client.id) sendToTabs(client, 'clean', [action, meta])
  })

  this.storageListener = function (e) {
    if (e.newValue === null) return

    var data
    if (e.key === storageKey(client, 'add')) {
      data = JSON.parse(e.newValue)
      if (!data[1].tab || data[1].tab === client.id) {
        client.emitter.emit('add', data[0], data[1])
      }
    } else if (e.key === storageKey(client, 'clean')) {
      data = JSON.parse(e.newValue)
      if (!data[1].tab || data[1].tab === client.id) {
        client.emitter.emit('clean', data[0], data[1])
      }
    } else if (e.key === storageKey(client, 'leader')) {
      setRole(client, 'follower')
      watchForLeader(client)
    } else if (e.key === storageKey(client, 'state')) {
      var state = JSON.parse(localStorage.getItem(e.key))
      if (client.state !== state) {
        client.state = state
        client.emitter.emit('state')
      }
    }
  }
  window.addEventListener('storage', this.storageListener)
}

Client.prototype = {

  /**
   * Connect to server and reconnect on any connection problem.
   *
   * @return {undefined}
   *
   * @example
   * app.start()
   */
  start: function start () {
    if (typeof localStorage === 'undefined') {
      this.role = 'leader'
      this.emitter.emit('role')
      this.sync.connection.connect()
      return
    }

    var activeLeader = false
    var leader = getLeader(this)
    if (leader[1] && leader[1] >= Date.now() - 5000) activeLeader = true

    if (activeLeader) {
      setRole(this, 'follower')
      watchForLeader(this)
    } else {
      var client = this
      leaderPing(client)
      setRole(client, 'candidate')
      client.elections = setTimeout(function () {
        var data = getLeader(client, 'leader')
        if (data[0] === client.id) {
          setRole(client, 'leader')
        } else {
          setRole(client, 'follower')
          watchForLeader(client)
        }
      }, 1000)
    }
  },

  /**
   * Disconnect and stop synchronization.
   *
   * @return {undefined}
   *
   * @example
   * shutdown.addEventListener('click', () => {
   *   app.destroy()
   * })
   */
  destroy: function destroy () {
    this.sync.destroy()
    clearTimeout(this.watching)
    clearTimeout(this.elections)
    clearInterval(this.leadership)
    window.removeEventListener('storage', this.storageListener)
  },

  /**
   * Clear stored data. Removes action log
   * from `IndexedDB`.
   *
   * @return {Promise} Promise when all data will be removed.
   *
   * @example
   * signout.addEventListener('click', () => {
   *   app.clean()
   * })
   */
  clean: function clean () {
    this.destroy()
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(storageKey(this, 'add'))
      localStorage.removeItem(storageKey(this, 'clean'))
      localStorage.removeItem(storageKey(this, 'state'))
      localStorage.removeItem(storageKey(this, 'leader'))
    }
    if (this.log.store.clean) {
      return this.log.store.clean()
    } else {
      this.log = undefined
      return Promise.resolve()
    }
  },

  /**
   * Subscribe for synchronization events. It implements nanoevents API.
   * Supported events:
   *
   * * `add`: action has been added to log (by any tab).
   * * `clean`: action has been removed from log (by any tab).
   * * `role`: tab role has been changed.
   * * `state`: leader tab synchronization state has been changed.
   *
   * @param {"add"|"clean"|"role"|"state"} event The event name.
   * @param {listener} listener The listener function.
   *
   * @return {function} Unbind listener from event.
   *
   * @example
   * app.on('add', (action, meta) => {
   *   dispatch(action)
   * })
   */
  on: function on (event, listener) {
    return this.emitter.on(event, listener)
  },

  /**
   * Add one-time listener for synchronization events.
   * See {@link Client#on} for supported events.
   *
   * @param {"add"|"clean"|"role"|"state"} event The event name.
   * @param {listener} listener The listener function.
   *
   * @return {function} Unbind listener from event.
   *
   * @example
   * app.once('clean', () => {
   *   cleaningWork = true
   * })
   */
  once: function once (event, listener) {
    return this.emitter.once(event, listener)
  }

}

Object.defineProperty(Client.prototype, 'connected', {
  get: function get () {
    return this.state !== 'disconnected' && this.state !== 'wait'
  }
})

module.exports = Client
