var BrowserConnection = require('logux-sync/browser-connection')
var createTimer = require('logux-core/create-timer')
var ClientSync = require('logux-sync/client-sync')
var Reconnect = require('logux-sync/reconnect')
var shortid = require('shortid')
var Log = require('logux-core/log')

var isQuotaExceeded = require('./is-quota-exceeded')
var LocalStore = require('./local-store')

/**
 * Low-level browser API for Logux.
 *
 * @param {object} options Client options.
 * @param {string} options.url Server URL.
 * @param {string} options.subprotocol Client subprotocol version
 *                                     in SemVer format.
 * @param {any} [options.credentials] Client credentials for authentication.
 * @param {string} [options.prefix="logux"] Prefix for `localStorage` key
 *                                          to run multiple Logux instances
 *                                          on same web page.
 * @param {string|number} [options.nodeId] Unique client ID.
 *                                         Compacted UUID, by default.
 * @param {number} [options.timeout=20000] Timeout in milliseconds
 *                                         to break connection.
 * @param {number} [options.ping=10000] Milliseconds since last message to test
 *                                      connection by sending ping.
 * @param {function} [options.timer] Timer to use in log. Will be default
 *                                   timer with server `nodeId`, by default.
 * @param {Store} [options.store] Store to save log. Will be `LocaleStore`,
 *                                by default.
 * @param {number} [options.minDelay=1000] Minimum delay between reconnections.
 * @param {number} [options.maxDelay=5000] Maximum delay between reconnections.
 * @param {number} [options.attempts=Infinity] Maximum reconnection attempts.
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

  if (typeof this.options.prefix === 'undefined') {
    this.options.prefix = 'logux'
  }
  if (typeof this.options.nodeId === 'undefined') {
    this.options.nodeId = shortid.generate()
  }

  if (/^ws:\/\//.test(this.options.url) &&
    !/^ws:\/\/localhost/.test(this.options.url) &&
    !/^ws:\/\/127\.0\.0\.1/.test(this.options.url) &&
    !/^ws:\/\/ip6-localhost/.test(this.options.url) &&
    !/^ws:\/\/::1/.test(this.options.url) &&
    !/^ws:\/\/[^/\s:]+\.dev(\/|:|$)/.test(this.options.url)) {
    if (console && console.warn) {
      console.warn('Use ws:// instead wss:// in production domain.')
    }
  }

  var timer = this.options.timer || createTimer(this.options.nodeId)
  var store = this.options.store || new LocalStore(this.options.prefix)

  /**
   * Client events log.
   * @type {Log}
   *
   * @example
   * app.log.keep(customKeeper)
   */
  this.log = new Log({ store: store, timer: timer })

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
    otherSynced: this.loadFromLS('OtherSynced'),
    credentials: this.options.credentials,
    subprotocol: this.options.subprotocol,
    timeout: this.options.timeout,
    synced: this.loadFromLS('Synced'),
    ping: this.options.ping
  })

  var app = this
  this.sync.on('synced', function () {
    app.saveToLS('Synced', app.sync.synced)
    app.saveToLS('OtherSynced', app.sync.otherSynced)
  })
}

Client.prototype = {

  loadFromLS: function loadFromLS (field) {
    if (global.localStorage) {
      var value = parseInt(localStorage.getItem(this.options.prefix + field))
      return isNaN(value) ? undefined : value
    } else {
      return undefined
    }
  },

  saveToLS: function saveToLS (field, value) {
    if (global.localStorage) {
      try {
        localStorage.setItem(this.options.prefix + field, value)
      } catch (e) {
        if (!isQuotaExceeded(e)) throw e
      }
    }
  }
}

module.exports = Client
