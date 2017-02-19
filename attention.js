/**
 * Highlight tabs on synchronization errors.
 *
 * @param {Syncable|Client} client Observed Client instance
 *                                 or object with `sync` property.
 *
 * @return {Function} Unbind attention listener.
 *
 * @example
 * import attention from 'logux-status/attention'
 * attention(client)
 */
function attention (client) {
  var sync = client.sync

  var originTitle = false
  var unbind = []

  function tabListener () {
    if (!doc.hidden && originTitle) {
      doc.title = originTitle
      originTitle = false
    }
  }

  var doc = document

  if (typeof doc !== 'undefined' && typeof doc.hidden !== 'undefined') {
    unbind.push(sync.on('error', function (error) {
      if (error.type !== 'timeout' && !originTitle && doc.hidden) {
        originTitle = document.title
        document.title += '*'
      }
    }))

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
