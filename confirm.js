/**
 * Show confirm popup, when user close tab with non-synchronized actions.
 *
 * @param {Client} client Observed Client instance.
 * @param {String} [warning] The text of the warning.
 *
 * @return {Function} Unbind confirm listener.
 *
 * @example
 * import confirm from 'logux-status/confirm'
 * confirm(client, 'Post does not saved to server. Are you sure to leave?')
 */
function confirm (client, warning) {
  warning = warning || 'Some data was not saved to server. ' +
                       'Are you sure to leave?'

  function listen (e) {
    if (typeof e === 'undefined') e = window.event
    if (e) e.returnValue = warning
    return warning
  }

  function update () {
    var unsaved = client.state === 'wait' || client.state === 'sending'
    if (client.role !== 'follower' && unsaved) {
      window.addEventListener('beforeunload', listen)
    } else {
      window.removeEventListener('beforeunload', listen)
    }
  }

  var unbind = []
  unbind.push(client.on('role', update))
  unbind.push(client.on('state', update))
  update()

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = confirm
