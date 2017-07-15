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
  var timeoutId = false

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

    if (doc.hidden) timeoutId = setTimeout(blink, 1000)
  }

  function tabListener () {
    if (!doc.hidden && timeoutId) {
      timeoutId = clearTimeout(timeoutId)
      restoreTitle()
    }
  }

  if (typeof doc !== 'undefined' && typeof doc.hidden !== 'undefined') {
    unbind.push(client.sync.on('error', function (error) {
      if (error.type !== 'timeout' && !timeoutId) {
        blink()
      }
    }))

    unbind.push(client.log.on('add', function (action) {
      if (action.type === 'logux/undo' && action.reason && !timeoutId) {
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
