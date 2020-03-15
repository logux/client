function block (e) {
  if (typeof e === 'undefined') e = window.event
  if (e) e.returnValue = 'unsynced'
  return 'unsynced'
}

/**
 * Show confirm popup, when user close tab with non-synchronized actions.
 *
 * @param {CrossTabClient} client Observed Client instance.
 *
 * @return {function} Unbind confirm listener.
 *
 * @example
 * import confirm from '@logux/client/confirm'
 * confirm(client)
 */
function confirm (client) {
  let disconnected = client.state === 'disconnected'
  let wait = false

  let update = () => {
    if (client.state === 'disconnected') {
      disconnected = true
    } else if (client.state === 'synchronized') {
      disconnected = false
      wait = false
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
      if (client.role !== 'follower' && wait && disconnected) {
        window.addEventListener('beforeunload', block)
      } else {
        window.removeEventListener('beforeunload', block)
      }
    }
  }

  let unbind = []
  unbind.push(client.on('role', update))
  unbind.push(client.on('state', update))
  update()

  unbind.push(client.on('add', (action, meta) => {
    if (action.type === 'logux/subscribe') {
      return
    } else if (action.type === 'logux/unsubscribe') {
      return
    }
    if (disconnected && meta.sync && meta.added) {
      wait = true
      update()
    }
  }))

  return () => {
    for (let i of unbind) i()
  }
}

module.exports = confirm
