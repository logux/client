/**
 * Show confirm popup, when user close tab with non-synchronized actions.
 *
 * @param {Syncable|Client} client Observed Client instance
 *                                 or object with `sync` property.
 * @param {String} [warning] The text of the warning.
 *
 * @return {Function} Unbind confirm listener.
 *
 * @example
 * import confirm from 'logux-status/confirm'
 * confirm(client, 'Post does not saved to server. Are you sure to leave?')
 */
function confirm (client, warning) {
  var sync = client.sync

  warning = warning || 'Some data was not saved to server. ' +
                       'Are you sure to leave?'

  function listen (e) {
    if (typeof e === 'undefined') e = window.event
    if (e) e.returnValue = warning
    return warning
  }

  return sync.on('state', function () {
    if (sync.state === 'wait' || sync.state === 'sending') {
      window.addEventListener('beforeunload', listen, false)
    } else {
      window.removeEventListener('beforeunload', listen, false)
    }
  })
}

module.exports = confirm
