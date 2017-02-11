var BaseSync = require('logux-sync').BaseSync

/**
 * Highlight tabs on sync object errors
 * @param {BaseSync} [sync] observed object
 * @param {BaseSync} [sync.sync] observed object
 * @returns {Function} Unbind attention listener
 */
function attention (sync) {
  if (typeof sync === 'undefined') {
    throw new Error('Missed sync argument in Logux Status attention')
  }

  if (!(sync instanceof BaseSync)) {
    if (typeof sync.sync === 'undefined' || !(sync.sync instanceof BaseSync)) {
      throw new Error('Wrong sync argument in Logux Status attention')
    } else {
      sync = sync.sync
    }
  }

  var oldTitle = null
  var unbind = []

  function tabListener () {
    if (!document.hidden && oldTitle) {
      document.title = oldTitle
      oldTitle = null
    }
  }

  if (typeof document !== 'undefined' &&
    typeof document.hidden !== 'undefined') {
    var errorCb = sync.on('error', function (error) {
      if (!(error.type === 'timeout' || oldTitle)) {
        oldTitle = document.title
        document.title += '*'
      }
    })

    unbind.push(errorCb)

    document.addEventListener('visibilitychange', tabListener, false)

    unbind.push(function () {
      document.removeEventListener('visibilitychange', tabListener, false)
    })
  }

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = attention
