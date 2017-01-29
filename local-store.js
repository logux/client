var MemoryStore = require('logux-core/memory-store')

var isQuotaExceeded = require('./is-quota-exceeded')

var VERSION = '0'

function warn (message) {
  if (console && console.error) console.error(message)
}

/**
 * `localStorage` store for Logux log. It is based on `MemoryStore`
 * and serialize log to `localStorage` on every change.
 *
 * @param {string} prefix="logux" Prefix for `localStorage` key to run
 *                                multiple Logux instances on same web page.
 *
 * @class
 * @extends Store
 *
 * @example
 * import LocalStore from 'logux-client/local-store'
 * const log = new Log({ store: new LocalStore(), timer }
 */
function LocalStore (prefix) {
  /**
   * `localStorage` key name.
   * @type {string}
   */
  this.key = prefix

  this.memory = new MemoryStore()

  for (var i in this.memory) {
    var method = this.memory[i]
    if (typeof method === 'function' && typeof this[i] === 'undefined') {
      this[i] = method.bind(this.memory)
    }
  }

  this.checkLocalStorage()
  this.load()
}

LocalStore.prototype = {

  add: function add () {
    var promise = this.memory.add.apply(this.memory, arguments)
    this.serialize()
    return promise
  },

  remove: function remove () {
    this.memory.remove.apply(this.memory, arguments)
    this.serialize()
  },

  setLastSynced: function setLastSynced () {
    var promise = this.memory.setLastSynced.apply(this.memory, arguments)
    this.serialize()
    return promise
  },

  serialize: function serialize () {
    var string = JSON.stringify(this.memory.created)
    try {
      localStorage.setItem(this.key, string)
      localStorage.setItem(this.key + 'Version', VERSION)
      localStorage.setItem(this.key + 'LastSent', this.memory.lastSent)
      localStorage.setItem(this.key + 'LastReceived', this.memory.lastReceived)
    } catch (e) {
      if (isQuotaExceeded(e)) {
        warn('Logux log become bigger than localStorage quota. ' +
             'Maybe you disable log autocleaning, have mistake in keepers ' +
             'or put very big object to log.')
      } else {
        throw e
      }
    }
  },

  load: function load () {
    var version = localStorage.getItem(this.key + 'Version')
    if (!version) return

    if (version !== VERSION) {
      warn('Logux log in localStorage is in outdated format. Log was ignored.')
      return
    }

    var string = localStorage.getItem(this.key)

    var created
    try {
      created = JSON.parse(string)
    } catch (e) {
      warn('Logux log in localStorage is broken. Log was cleaned.')
      localStorage.removeItem(this.key)
      localStorage.removeItem(this.key + 'Version')
      localStorage.removeItem(this.key + 'LastSent')
      localStorage.removeItem(this.key + 'LastReceived')
      return
    }

    this.memory.lastSent = parseInt(
      localStorage.getItem(this.key + 'LastSent'))
    this.memory.lastReceived = parseInt(
      localStorage.getItem(this.key + 'LastReceived'))

    this.memory.created = created
    this.memory.added = created.slice(0).sort(function (a, b) {
      return b[1].added - a[1].added
    })
    if (this.memory.added.length > 0) {
      this.memory.lastAdded = this.memory.added[0][1].added
    }
  },

  checkLocalStorage: function checkLocalStorage () {
    if (!global.localStorage) {
      warn('Logux didn’t find localStorage. Memory-only store was used.')
      this.serialize = this.load = function () { }
    }
  }

}

module.exports = LocalStore
