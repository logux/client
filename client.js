var BrowserConnection = require('logux-sync/browser-connection')
var MemoryStore = require('logux-core/memory-store')
var urlAlphabet = require('nanoid/url')
var generateId = require('nanoid/generate')
var ClientSync = require('logux-sync/client-sync')
var NanoEvents = require('nanoevents')
var Reconnect = require('logux-sync/reconnect')
var Log = require('logux-core/log')

var IndexedStore = require('./indexed-store')

function tabPing (client) {
  localStorage.setItem(client.options.prefix + ':tab:' + client.id, Date.now())
}

function cleanTabActions (client, id) {
  client.log.removeReason('tab' + id).then(function () {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(client.options.prefix + ':tab:' + id)
    }
  })
}

var ALLOWED_META = ['id', 'time', 'nodeIds', 'users', 'channels']

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

  if (typeof this.options.prefix === 'undefined') {
    this.options.prefix = 'logux'
  }

  /**
   * Unique client ID. Can be used to add an action to the specific tab.
   * @type {string}
   *
   * @example
   * app.log.add(action, { tab: app.id })
   */
  this.id = generateId(urlAlphabet, 8)
  this.options.userId = this.options.userId.toString()

  /**
   * Unique Logux node ID.
   * @type {string}
   *
   * @example
   * console.log('Client ID: ', app.nodeId)
   */
  this.nodeId = this.options.userId + ':' + this.id

  var auth
  if (/^ws:\/\//.test(this.options.server) && !options.allowDangerousProtocol) {
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
  this.log = new Log({ store: store, nodeId: this.nodeId })

  var client = this

  this.log.on('preadd', function (action, meta) {
    if (meta.id[1] === client.nodeId && !meta.subprotocol) {
      meta.subprotocol = client.options.subprotocol
    }
  })

  this.subscriptions = { }
  function listener (action, meta) {
    if (action.type === 'logux/subscribe') {
      client.subscriptions[action.name] = action
      if (!meta.sync) {
        console.error('logux/subscribe action without meta.sync')
      }
    } else if (action.type === 'logux/unsubscribe') {
      delete client.subscriptions[action.name]
      if (!meta.sync) {
        console.error('logux/unsubscribe action without meta.sync')
      }
    }
  }

  this.emitter = new NanoEvents()

  if (this.on) {
    this.on('add', listener)
  } else {
    this.log.on('add', listener)
  }

  this.tabPing = 60000
  this.tabTimeout = 10 * this.tabPing
  var reason = 'tab' + client.id
  if (typeof localStorage !== 'undefined') {
    var unbind = this.log.on('add', function (action, meta) {
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
    var ws = new BrowserConnection(this.options.server)
    connection = new Reconnect(ws, {
      minDelay: this.options.minDelay,
      maxDelay: this.options.maxDelay,
      attempts: this.options.attempts
    })
  } else {
    connection = this.options.server
  }

  function filter (action, meta) {
    var user = meta.id[1].split(':')[0]
    return Promise.resolve(meta.sync && user === client.options.userId)
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
   * Sync instance from `logux-sync` to synchronize logs.
   * @type {ClientSync}
   *
   * @example
   * if (client.sync.state === 'synchronized')
   */
  this.sync = new ClientSync(this.nodeId, this.log, connection, {
    credentials: this.options.credentials,
    subprotocol: this.options.subprotocol,
    outFilter: filter,
    timeout: this.options.timeout,
    outMap: map,
    ping: this.options.ping,
    auth: auth
  })

  this.sync.on('debug', function (type, stack) {
    if (type === 'error') {
      console.error('Error on Logux server:\n', stack)
    }
  })

  this.sync.on('connect', function () {
    for (var i in client.subscriptions) {
      client.log.add(client.subscriptions[i], { sync: true })
    }
  })

  this.onUnload = this.onUnload.bind(this)
  window.addEventListener('unload', this.onUnload)
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
    this.sync.connection.connect()
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
    this.sync.destroy()
    clearInterval(this.pinging)
    window.removeEventListener('unload', this.onUnload)
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
    if (this.log.store.clean) {
      return this.log.store.clean()
    } else {
      return Promise.resolve()
    }
  },

  cleanPrevActions: function cleanPrevActions () {
    if (typeof localStorage === 'undefined') return

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
  }

}

module.exports = Client
