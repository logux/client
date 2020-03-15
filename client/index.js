let { createNanoEvents } = require('nanoevents')
let { isFirstOlder } = require('@logux/core/is-first-older')
let { WsConnection } = require('@logux/core/ws-connection')
let { MemoryStore } = require('@logux/core/memory-store')
let { ClientNode } = require('@logux/core/client-node')
let { Reconnect } = require('@logux/core/reconnect')
let { Log } = require('@logux/core/log')
let nanoid = require('nanoid')

function tabPing (c) {
  localStorage.setItem(c.options.prefix + ':tab:' + c.tabId, Date.now())
}

function cleanTabActions (client, id) {
  client.log.removeReason('tab' + id).then(() => {
    if (client.isLocalStorage) {
      localStorage.removeItem(client.options.prefix + ':tab:' + id)
    }
  })
}

let ALLOWED_META = ['id', 'time', 'channels']

/**
 * Base class for browser API to be extended in {@link CrossTabClient}.
 *
 * Because this class could have conflicts between different browser tab,
 * you should use it only if you are really sure, that application will not
 * be run in different tab (for instance, if you are developing a kiosk app).
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
 * import { Client } from '@logux/client'
 *
 * const userId = document.querySelector('meta[name=user]').content
 * const token = document.querySelector('meta[name=token]').content
 *
 * const app = new Client({
 *   credentials: token,
 *   subprotocol: '1.0.0',
 *   server: 'wss://example.com:1337',
 *   userId: userId
 * })
 * app.start()
 *
 * @class
 */
class Client {
  constructor (opts = { }) {
    /**
     * Client options.
     * @type {object}
     *
     * @example
     * console.log('Connecting to ' + app.options.server)
     */
    this.options = opts

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
      let random = nanoid()
      try {
        localStorage.setItem(random, '1')
        localStorage.removeItem(random)
        this.isLocalStorage = true
      } catch (e) {}
    }

    if (this.options.userId) {
      this.options.userId = this.options.userId.toString()
    } else {
      this.options.userId = 'false'
    }

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
       * app.log.add(action, { tab: app.tabId })
       */
      this.tabId = nanoid(8)
    } else {
      this.tabId = this.options.time.lastId + 1 + ''
      this.clientId = this.options.userId + ':' + this.tabId
    }

    /**
     * Unique Logux node ID.
     * @type {string}
     *
     * @example
     * console.log('Client ID: ', app.nodeId)
     */
    this.nodeId = this.clientId + ':' + this.tabId

    let auth
    if (/^ws:\/\//.test(this.options.server) && !opts.allowDangerousProtocol) {
      auth = async cred => {
        if (typeof cred !== 'object' || cred.env !== 'development') {
          console.error(
            'Without SSL, old proxies block WebSockets. ' +
            'Use WSS for Logux or set allowDangerousProtocol option.'
          )
          return false
        } else {
          return true
        }
      }
    }

    let store = this.options.store || new MemoryStore()

    let log
    if (this.options.time) {
      log = this.options.time.nextLog({ store, nodeId: this.nodeId })
    } else {
      log = new Log({ store, nodeId: this.nodeId })
    }
    /**
     * Client events log.
     * @type {Log}
     *
     * @example
     * app.log.keep(customKeeper)
     */
    this.log = log

    log.on('preadd', (action, meta) => {
      let isOwn = meta.id.includes(` ${ this.nodeId } `)
      if (isOwn && !meta.subprotocol) {
        meta.subprotocol = this.options.subprotocol
      }
      if (meta.sync && !meta.resubscribe) meta.reasons.push('syncing')
    })

    this.last = { }
    this.subscriptions = { }
    let subscribing = { }
    let unsubscribing = { }

    this.emitter = createNanoEvents()
    this.on('add', (action, meta) => {
      let type = action.type
      let json, last
      if (type === 'logux/processed' || type === 'logux/undo') {
        this.log.removeReason('syncing', { id: action.id })
      }
      if (type === 'logux/subscribe' && !meta.resubscribe) {
        subscribing[meta.id] = action
      } else if (type === 'logux/unsubscribe') {
        unsubscribing[meta.id] = action
      } else if (type === 'logux/processed' && unsubscribing[action.id]) {
        let unsubscription = unsubscribing[action.id]
        json = JSON.stringify({ ...unsubscription, type: 'logux/subscribe' })
        let subscribers = this.subscriptions[json]
        if (subscribers) {
          if (subscribers === 1) {
            delete this.subscriptions[json]
          } else {
            this.subscriptions[json] = subscribers - 1
          }
        }
      } else if (type === 'logux/processed' && subscribing[action.id]) {
        let subscription = subscribing[action.id]
        delete subscribing[action.id]
        json = JSON.stringify(subscription)
        if (this.subscriptions[json]) {
          this.subscriptions[json] += 1
        } else {
          this.subscriptions[json] = 1
        }
        last = this.last[subscription.channel]
        if (!last || isFirstOlder(last, meta)) {
          this.last[subscription.channel] = { id: meta.id, time: meta.time }
        }
      } else if (type === 'logux/undo') {
        delete subscribing[action.id]
        delete unsubscribing[action.id]
      } else if (meta.channels) {
        if (!meta.id.includes(' ' + this.clientId + ':')) {
          meta.channels.forEach(channel => {
            last = this.last[channel]
            if (!last || isFirstOlder(last, meta)) {
              this.last[channel] = { id: meta.id, time: meta.time }
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
    })

    this.tabPing = 60000
    this.tabTimeout = 10 * this.tabPing
    let reason = 'tab' + this.tabId
    if (this.isLocalStorage) {
      let unbind = log.on('add', (action, meta) => {
        if (meta.reasons.includes(reason)) {
          tabPing(this)
          this.pinging = setInterval(() => {
            tabPing(this)
          }, this.tabPing)
          unbind()
        }
      })
    }

    let connection
    if (typeof this.options.server === 'string') {
      let ws = new WsConnection(this.options.server)
      connection = new Reconnect(ws, {
        minDelay: this.options.minDelay,
        maxDelay: this.options.maxDelay,
        attempts: this.options.attempts
      })
    } else {
      connection = this.options.server
    }

    let outFilter = async (action, meta) => {
      let user = meta.id.split(' ')[1].replace(/:.*$/, '')
      return !!meta.sync && user === this.options.userId
    }

    let outMap = async (action, meta) => {
      let filtered = { }
      for (let i in meta) {
        if (ALLOWED_META.includes(i)) {
          filtered[i] = meta[i]
        }
        if (meta.subprotocol && meta.subprotocol !== this.options.subprotocol) {
          filtered.subprotocol = meta.subprotocol
        }
      }
      return [action, filtered]
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
      outFilter,
      timeout: this.options.timeout,
      outMap,
      ping: this.options.ping,
      auth
    })

    this.node.on('debug', (type, stack) => {
      if (type === 'error') {
        console.error('Error on Logux server:\n', stack)
      }
    })

    let disconnected = true
    this.node.on('state', () => {
      let state = this.node.state
      if (state === 'synchronized' || state === 'sending') {
        if (disconnected) {
          disconnected = false
          for (let i in this.subscriptions) {
            let action = JSON.parse(i)
            let since = this.last[action.channel]
            if (since) action.since = since
            this.log.add(action, { sync: true, resubscribe: true })
          }
        }
      } else if (this.node.state === 'disconnected') {
        disconnected = true
      }
    })

    this.onUnload = this.onUnload.bind(this)
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('unload', this.onUnload)
    }
  }

  /**
   * Connect to server and reconnect on any connection problem.
   *
   * @return {undefined}
   *
   * @example
   * app.start()
   */
  start () {
    this.cleanPrevActions()
    this.node.connection.connect()
  }

  /**
   * Subscribe for synchronization events. It implements Nano Events API.
   * Supported events:
   *
   * * `preadd`: action is going to be added (in current tab).
   * * `add`: action has been added to log (by any tab).
   * * `clean`: action has been removed from log (by any tab).
   *
   * @param {"preadd"|"add"|"clean"} event The event name.
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
    return this.log.emitter.on(event, listener)
  }

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
  destroy () {
    this.onUnload()
    this.node.destroy()
    clearInterval(this.pinging)
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('unload', this.onUnload)
    }
  }

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
  clean () {
    this.destroy()
    return this.log.store.clean ? this.log.store.clean() : Promise.resolve()
  }

  cleanPrevActions () {
    if (!this.isLocalStorage) return

    for (let i in localStorage) {
      let prefix = this.options.prefix + ':tab:'
      if (i.slice(0, prefix.length) === prefix) {
        let time = parseInt(localStorage.getItem(i))
        if (Date.now() - time > this.tabTimeout) {
          cleanTabActions(this, i.slice(prefix.length))
        }
      }
    }
  }

  onUnload () {
    if (this.pinging) cleanTabActions(this, this.tabId)
  }

  getClientId () {
    return nanoid(8)
  }
}

module.exports = { Client }
