var MemoryStore = require('logux-core/memory-store')

var VERSION = '0'

function warn (message) {
  if (console && console.error) console.error(message)
}

function isQuotaExceeded (e) {
  if (e.code === DOMException.QUOTA_EXCEEDED_ERR) {
    // Standard
    return true
  } else if (e.code === 1014 && e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    // Firefox
    return true
  } else {
    return false
  }
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
  this.key = prefix + 'Log'

  this.memory = new MemoryStore()

  for (var i in this.memory) {
    var method = this.memory[i]
    if (typeof method === 'function' && typeof this[i] === 'undefined') {
      this[i] = method.bind(this.memory)
    }
  }

  this.checkLocalStorage()
  this.deserialize()
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

  serialize: function serialize () {
    var string = JSON.stringify(this.memory.created)
    try {
      localStorage.setItem(this.key, string)
      localStorage.setItem(this.key + 'Version', VERSION)
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

  deserialize: function deserialize () {
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
      return
    }

    this.memory.created = created
    this.memory.added = created.slice(0).sort(function (a, b) {
      return b[1].added - a[1].added
    })
  },

  checkLocalStorage: function checkLocalStorage () {
    if (!global.localStorage) {
      warn('Logux didn’t find localStorage. Memory-only store was used.')
      this.serialize = function () { }
      this.deserialize = function () { }
    }
  }

}

module.exports = LocalStore
