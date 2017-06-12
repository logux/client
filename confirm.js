/**
 * Show confirm popup, when user close tab with non-synchronized actions.
 *
 * @param {CrossTabClient} client Observed Client instance.
 *
 * @return {Function} Unbind confirm listener.
 *
 * @example
 * import confirm from 'logux-status/confirm'
 * confirm(client, 'Post does not saved to server. Are you sure to leave?')
 */
function confirm (client) {
  function listen (e) {
    if (typeof e === 'undefined') e = window.event
    if (e) e.returnValue = 'unsynced'
    return 'unsynced'
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
