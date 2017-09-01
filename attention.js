/**
 * Highlight tabs on synchronization errors.
 *
 * @param {Client} client Observed Client instance.
 *
 * @return {Function} Unbind attention listener.
 *
 * @example
 * import attention from 'logux-status/attention'
 * attention(client)
 */
function attention (client) {
  var doc = document
  var originTitle = false
  var unbind = []
  var timeout = false

  function restoreTitle () {
    if (originTitle) {
      doc.title = originTitle
      originTitle = false
    }
  }

  function blink () {
    if (doc.hidden && !originTitle) {
      originTitle = doc.title
      doc.title = '* ' + doc.title
    } else {
      restoreTitle()
    }

    if (doc.hidden) timeout = setTimeout(blink, 1000)
  }

  function tabListener () {
    if (!doc.hidden && timeout) {
      timeout = clearTimeout(timeout)
      restoreTitle()
    }
  }

  if (doc && typeof doc.hidden !== 'undefined') {
    unbind.push(client.sync.on('error', function (error) {
      if (error.type !== 'timeout' && !timeout) {
        blink()
      }
    }))

    unbind.push(client.log.on('add', function (action) {
      if (action.type === 'logux/undo' && action.reason && !timeout) {
        blink()
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
