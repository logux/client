/**
 * Logux confirm close tab if there are unsynchronized actions.
 *
 * @param {Syncable|BaseSync} sync Observed Sync instance.
 * @param {String} [warning=Not all data will be synchronize with the server
 *                          if you leave the page.] The text of the warning.
 *
 * @return {Function} Unbind confirm listener.
 *
 * @example
 * import confirm from 'logux-status/confirm'
 * confirm(client, 'Edits were not synchronize, do not leave the page.')
 */
function confirm (sync, warning) {
  if (sync.sync) sync = sync.sync

  warning = warning || 'Not all data will be synchronize with the server ' +
                       'if you leave the page.'

  var unbind = []

  unbind.push(sync.on('state', function () {
    if (typeof window.onbeforeunload !== 'undefined') {
      if (sync.state === 'wait' || sync.state === 'sending') {
        window.onbeforeunload = function (e) {
          if (typeof e === 'undefined') e = window.event
          if (e) {
            e.returnValue = warning
          }
          return warning
        }
      }
    }
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = confirm
