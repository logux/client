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
  var disconnected = client.state === 'disconnected'
  var wait = false

  function listen (e) {
    if (typeof e === 'undefined') e = window.event
    if (e) e.returnValue = 'unsynced'
    return 'unsynced'
  }

  function update () {
    if (client.state === 'disconnected') {
      disconnected = true
    } else if (client.state === 'synchronized') {
      disconnected = false
    }
    var unsaved = wait && disconnected

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

  unbind.push(client.log.on('add', function (action, meta) {
    if (disconnected && meta.sync && meta.added) {
      wait = true
      update()
    }
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = confirm
