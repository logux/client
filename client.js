var BrowserConnection = require('logux-sync/browser-connection')
var MemoryStore = require('logux-core/memory-store')
var ClientSync = require('logux-sync/client-sync')
var Reconnect = require('logux-sync/reconnect')
var shortid = require('shortid/lib/build')
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

/**
 * Base class for browser API to be extended in {@link CrossTabClient}.
 *
 * Because this class could have conflicts between different browser tab,
 * you should use it only if you are really sure, that application will not
 * be run in different tab (for instance, if you are developing a kiosk app).
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

  var client = this
  this.tabPing = 60000
  if (typeof localStorage !== 'undefined') {
    this.log.on('add', function (action, meta) {
      if (!client.pinging && meta.tab === client.id) {
        tabPing(client)
        client.pinging = setInterval(function () {
          tabPing(client)
        }, client.tabPing)
      }
    })
  }

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

  this.sync.on('debug', function (type, stack) {
    if (type === 'error') {
      console.error('Error on Logux server:\n', stack)
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

  onUnload: function onUnload () {
    if (this.pinging) cleanTabActions(this, this.id)
  }

}

module.exports = Client
