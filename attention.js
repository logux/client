/**
 * Highlight tabs on sync object errors
 * @param {Sync} sync observed object
 * @param {Sync} sync.sync observed object
 * @returns {Function} Unbind attention listener
 */
function attention (sync) {
  if (typeof sync === 'undefined') {
    throw new Error('Missed sync argument in Logux Status attention')
  }

  sync = sync.sync ? sync.sync : sync

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
