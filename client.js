var BrowserConnection = require('logux-sync/browser-connection')
var MemoryStore = require('logux-core/memory-store')
var ClientSync = require('logux-sync/client-sync')
var NanoEvents = require('nanoevents')
var Reconnect = require('logux-sync/reconnect')
var shortid = require('shortid/lib/build')
var Log = require('logux-core/log')

var IndexedStore = require('./indexed-store')

/**
 * Low-level browser API for Logux.
 *
 * @param {object} options Client options.
 * @param {string} options.url Server URL.
 * @param {string} options.subprotocol Client subprotocol version
 *                                     in SemVer format.
 * @param {number|string|false} options.userId User ID. Pass `false` on no user.
 * @param {any} [options.credentials] Client credentials for authentication.
 * @param {string} [options.prefix="logux"] Prefix for `IndexedDB` database
 *                                          to run multiple Logux instances
 *                                          on same web page.
 * @param {string|number} [options.nodeId] Unique client ID.
 *                                         Compacted UUID, by default.
 * @param {number} [options.timeout=20000] Timeout in milliseconds
 *                                         to break connection.
 * @param {number} [options.ping=10000] Milliseconds since last message to test
 *                                      connection by sending ping.
 * @param {Store} [options.store] Store to save log. Will be `IndexedStore`,
 *                                by default.
 * @param {number} [options.minDelay=1000] Minimum delay between reconnections.
 * @param {number} [options.maxDelay=5000] Maximum delay between reconnections.
 * @param {number} [options.attempts=Infinity] Maximum reconnection attempts.
 * @param {bool} [options.allowDangerousProtocol=false] Hide warning in case
 *                                                      using ws: in production.
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
 * app.sync.connection.connect()
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
   * Unique browser tab ID.
   * @type {string}
   *
   * @example
   * app.log.add(action, { tab: app.tabId })
   */
  this.tabId = shortid(0)

  var userId = this.options.userId
  if (userId) {
    userId += ':'
  } else {
    userId = ''
  }
  this.options.nodeId = userId + this.tabId

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

  this.emitter = new NanoEvents()

  this.sync.on('debug', function (type, stack) {
    if (type === 'error') {
      console.error('Error on Logux server:\n', stack)
    }
  })

  var client = this
  this.log.on('add', function (action, meta) {
    client.emitter.emit('add', action, meta)
    client.send('Add', [action, meta])
  })
  this.log.on('clean', function (action, meta) {
    client.emitter.emit('clean', action, meta)
    client.send('Clean', [action, meta])
  })

  var prefix = this.options.prefix
  window.addEventListener('storage', function (e) {
    if (e.key.slice(0, prefix.length) !== prefix) return

    var event = e.key.slice(prefix.length)
    var data = JSON.parse(e.newValue)
    if (event === 'Add') {
      if (!data[1].tab || data[1].tab === client.tabId) {
        client.emitter.emit('add', data[0], data[1])
      }
    } else if (event === 'Clean') {
      if (!data[1].tab || data[1].tab === client.tabId) {
        client.emitter.emit('clean', data[0], data[1])
      }
    }
  })
}

Client.prototype = {

  /**
   * Clear every stored data. It will remove action log
   * from `IndexedDB`.
   *
   * @return {Promise} Promise when all data will be removed.
   *
   * @example
   * signout.addEventListener('click', () => {
   *   app.clean()
   * }, false)
   */
  clean: function clean () {
    this.sync.destroy()
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.options.prefix + 'Add')
      localStorage.removeItem(this.options.prefix + 'Clean')
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
   * * `add`: action was added to log by any browser tabs.
   * * `clean`: action was cleaned to log by any browser tabs.
   *
   * @param {"add"|"clean"} event The event name.
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
   * @param {"add"|"clean"} event The event name.
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
  },

  send: function send (event, data) {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(this.options.prefix + event, JSON.stringify(data))
  }

}

module.exports = Client
