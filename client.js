var isFirstOlder = require('@logux/core/is-first-older')
var WsConnection = require('@logux/core/ws-connection')
var MemoryStore = require('@logux/core/memory-store')
var ClientNode = require('@logux/core/client-node')
var NanoEvents = require('nanoevents')
var Reconnect = require('@logux/core/reconnect')
var nanoid = require('nanoid')
var Log = require('@logux/core/log')

var IndexedStore = require('./indexed-store')

function tabPing (client) {
  localStorage.setItem(client.options.prefix + ':tab:' + client.id, Date.now())
}

function cleanTabActions (client, id) {
  client.log.removeReason('tab' + id).then(function () {
    if (client.isLocalStorage) {
      localStorage.removeItem(client.options.prefix + ':tab:' + id)
    }
  })
}

function merge (a, b) {
  var result = { }
  for (var i in a) {
    if (b[i]) {
      result[i] = b[i]
    } else {
      result[i] = a[i]
    }
  }
  return result
}

var ALLOWED_META = ['id', 'time', 'nodes', 'users', 'clients', 'channels']

var subscribing = { }

/**
 * Base class for browser API to be extended in {@link CrossTabClient}.
 *
 * Because this class could have conflicts between different browser tab,
 * you should use it only if you are really sure, that application will not
 * be run in different tab (for instance, if you are developing a kiosk app).
 *
 * @param {object} options Client options.
 * @param {string|Connection} options.server Server URL.
 * @param {string} options.subprotocol Client subprotocol version
 *                                     in SemVer format.
 * @param {number|string|false} options.userId User ID. Pass `false` if no user.
 * @param {any} [options.credentials] Client credentials for authentication.
 * @param {string} [options.prefix="logux"] Prefix for `IndexedDB` database
 *                                          to run multiple Logux instances
 *                                          in the same browser.
 * @param {number} [options.timeout=20000] Timeout in milliseconds
 *                                         to break connection.
 * @param {number} [options.ping=10000] Milliseconds since last message to test
 *                                      connection by sending ping.
 * @param {Store} [options.store] Store to save log data. `IndexedStore`
 *                                by default (if available)
 * @param {TestTime} [options.time] Test time to test client.
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
 *   server: 'wss://example.com:1337',
 *   userId: 10
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
   * console.log('Connecting to ' + app.options.server)
   */
  this.options = options || { }

  if (process.env.NODE_ENV !== 'production') {
    if (typeof this.options.server === 'undefined') {
      throw new Error('Missed server option in Logux client')
    }
    if (typeof this.options.subprotocol === 'undefined') {
      throw new Error('Missed subprotocol option in Logux client')
    }
    if (typeof this.options.userId === 'undefined') {
      throw new Error('Missed userId option in Logux client. ' +
                      'Pass false if you have no users.')
    }
  }

  if (typeof this.options.prefix === 'undefined') {
    this.options.prefix = 'logux'
  }

  this.isLocalStorage = false
  if (typeof localStorage !== 'undefined') {
    var random = nanoid()
    try {
      localStorage.setItem(random, '1')
      localStorage.removeItem(random)
      this.isLocalStorage = true
    } catch (e) {}
  }

  this.options.userId = this.options.userId.toString()
  if (!this.options.time) {
    /**
     * Unique permanent client ID. Can be used to track this machine.
     * @type {string}
     */
    this.clientId = this.options.userId + ':' + this.getClientId()
    /**
     * Unique tab ID. Can be used to add an action to the specific tab.
     * @type {string}
     *
     * @example
     * app.log.add(action, { tab: app.id })
     */
    this.id = nanoid(8)
  } else {
    this.id = this.options.time.lastId + 1 + ''
    this.clientId = this.options.userId + ':' + this.id
  }

  /**
   * Unique Logux node ID.
   * @type {string}
   *
   * @example
   * console.log('Client ID: ', app.nodeId)
   */
  this.nodeId = this.clientId + ':' + this.id

  var auth
  if (/^ws:\/\//.test(this.options.server) && !options.allowDangerousProtocol) {
    auth = function (cred) {
      if (typeof cred !== 'object' || cred.env !== 'development') {
        console.error(
          'Without SSL, old proxies block WebSockets. ' +
          'Use WSS for Logux or set allowDangerousProtocol option.'
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

  var log
  if (this.options.time) {
    log = this.options.time.nextLog({ store: store, nodeId: this.nodeId })
  } else {
    log = new Log({ store: store, nodeId: this.nodeId })
  }
  /**
   * Client events log.
   * @type {Log}
   *
   * @example
   * app.log.keep(customKeeper)
   */
  this.log = log

  var client = this

  log.on('preadd', function (action, meta) {
    var isOwn = meta.id.indexOf(' ' + client.nodeId + ' ') !== -1
    if (isOwn && !meta.subprotocol) {
      meta.subprotocol = client.options.subprotocol
    }
  })

  this.last = { }
  this.subscriptions = []
  function listener (action, meta) {
    var type = action.type
    var json, last
    if (type === 'logux/subscribe') {
      json = JSON.stringify(action)
      var already = client.subscriptions.some(function (i) {
        return i.channel === action.channel && JSON.stringify(i) === json
      })
      subscribing[meta.id] = action.channel
      if (!already) client.subscriptions.push(action)
    } else if (type === 'logux/unsubscribe') {
      json = JSON.stringify(merge(action, { type: 'logux/subscribe' }))
      client.subscriptions = client.subscriptions.filter(function (i) {
        return i.channel !== action.channel || JSON.stringify(i) !== json
      })
    } else if (type === 'logux/processed' && subscribing[action.id]) {
      var subscribed = subscribing[action.id]
      delete subscribing[action.id]
      last = client.last[subscribed]
      if (!last || isFirstOlder(last, meta)) {
        client.last[subscribed] = { id: meta.id, time: meta.time }
      }
    } else if (meta.channels) {
      if (meta.id.indexOf(' ' + client.clientId + ':') === -1) {
        meta.channels.forEach(function (channel) {
          last = client.last[channel]
          if (!last || isFirstOlder(last, meta)) {
            client.last[channel] = { id: meta.id, time: meta.time }
          }
        })
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      if (type === 'logux/subscribe' || type === 'logux/unsubscribe') {
        if (!meta.sync) {
          console.error(type + ' action without meta.sync')
        }
      }
    }
  }

  this.emitter = new NanoEvents()

  if (this.on) {
    this.on('add', listener)
  } else {
    log.on('add', listener)
  }

  this.tabPing = 60000
  this.tabTimeout = 10 * this.tabPing
  var reason = 'tab' + client.id
  if (this.isLocalStorage) {
    var unbind = log.on('add', function (action, meta) {
      if (meta.reasons.indexOf(reason) !== -1) {
        tabPing(client)
        client.pinging = setInterval(function () {
          tabPing(client)
        }, client.tabPing)
        unbind()
      }
    })
  }

  var connection
  if (typeof this.options.server === 'string') {
    var ws = new WsConnection(this.options.server)
    connection = new Reconnect(ws, {
      minDelay: this.options.minDelay,
      maxDelay: this.options.maxDelay,
      attempts: this.options.attempts
    })
  } else {
    connection = this.options.server
  }

  function filter (action, meta) {
    var user = meta.id.split(' ')[1].replace(/:.*$/, '')
    return Promise.resolve(!!meta.sync && user === client.options.userId)
  }

  function map (action, meta) {
    var filtered = { }
    for (var i in meta) {
      if (ALLOWED_META.indexOf(i) !== -1) {
        filtered[i] = meta[i]
      }
      if (meta.subprotocol && meta.subprotocol !== client.options.subprotocol) {
        filtered.subprotocol = meta.subprotocol
      }
    }
    return Promise.resolve([action, filtered])
  }

  /**
   * Node instance to synchronize logs.
   * @type {ClientNode}
   *
   * @example
   * if (client.node.state === 'synchronized')
   */
  this.node = new ClientNode(this.nodeId, this.log, connection, {
    credentials: this.options.credentials,
    subprotocol: this.options.subprotocol,
    outFilter: filter,
    timeout: this.options.timeout,
    outMap: map,
    ping: this.options.ping,
    auth: auth
  })

  this.node.on('debug', function (type, stack) {
    if (type === 'error') {
      console.error('Error on Logux server:\n', stack)
    }
  })

  var lost = false
  this.node.on('state', function () {
    if (client.node.state === 'synchronized' && lost) {
      lost = false
      for (var i in client.subscriptions) {
        var action = merge(client.subscriptions[i], { })
        var since = client.last[action.channel]
        if (since) action.since = since
        client.log.add(action, { sync: true })
      }
    } else if (client.node.state === 'disconnected') {
      lost = true
    }
  })

  this.onUnload = this.onUnload.bind(this)
  if (typeof window !== 'undefined') {
    window.addEventListener('unload', this.onUnload)
  }
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
    this.cleanPrevActions()
    this.node.connection.connect()
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
    this.onUnload()
    this.node.destroy()
    clearInterval(this.pinging)
    if (typeof window !== 'undefined') {
      window.removeEventListener('unload', this.onUnload)
    }
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
    return this.log.store.clean ? this.log.store.clean() : Promise.resolve()
  },

  cleanPrevActions: function cleanPrevActions () {
    if (!this.isLocalStorage) return

    for (var i in localStorage) {
      var prefix = this.options.prefix + ':tab:'
      if (i.slice(0, prefix.length) === prefix) {
        var time = parseInt(localStorage.getItem(i))
        if (Date.now() - time > this.tabTimeout) {
          cleanTabActions(this, i.slice(prefix.length))
        }
      }
    }
  },

  onUnload: function onUnload () {
    if (this.pinging) cleanTabActions(this, this.id)
  },

  getClientId: function getClientId () {
    return nanoid(8)
  }

}

module.exports = Client
