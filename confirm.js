/**
 * Show confirm popup, when user close tab with non-synchronized actions.
 *
 * @param {Syncable|BaseSync} sync Observed Sync instance.
 * @param {String} [warning] The text of the warning.
 *
 * @return {Function} Unbind confirm listener.
 *
 * @example
 * import confirm from 'logux-status/confirm'
 * confirm(client, 'Post does not saved to server. Are you sure to leave?')
 */
function confirm (sync, warning) {
  if (sync.sync) sync = sync.sync

  warning = warning || 'Some data was not saved to server. ' +
                       'Are you sure to leave?'

  return sync.on('state', function () {
    if (typeof window.onbeforeunload !== 'undefined') {
      if (sync.state === 'wait' || sync.state === 'sending') {
        window.onbeforeunload = function (e) {
          if (typeof e === 'undefined') e = window.event
          if (e) e.returnValue = warning
          return warning
        }
      }
    }
  })
}

module.exports = confirm
