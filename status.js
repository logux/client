/**
 * Low-level function to show Logux synchronization status with your custom UI.
 * It is used in {@link badge} widget.
 *
 * @param {Syncable|Client} client Observed Client instance
 *                                 or object with `sync` property.
 * @param {object} callbacks Status callbacks.
 * @param {function} [callbacks.synchronized] All actions were synchronized.
 * @param {function} [callbacks.disconnected] Has no connection to server.
 * @param {function} [callbacks.wait] No connection and we have actions
 *                                    for synchronization.
 * @param {function} [callbacks.connecting] In the middle of connection
 *                                          to server.
 * @param {function} [callbacks.sending] Connection was established, sending
 *                                       action to server.
 * @param {function} [callbacks.syncError] Logux synchronization error.
 * @param {function} [callbacks.error] Server error during action processing.
 * @param {function} [callbacks.denied] Action was denied from server.
 * @param {function} [callbacks.protocolError] User need to update client.
 *
 * @return {Function} Unbind status listener.
 */
function status (client, callbacks) {
  var sync = client.sync

  var unbind = []

  unbind.push(sync.on('state', function () {
    if (callbacks[sync.state]) callbacks[sync.state]()
  }))

  unbind.push(sync.on('error', function (error) {
    if (error.type === 'wrong-protocol' || error.type === 'wrong-subprotocol') {
      if (callbacks.protocolError) callbacks.protocolError()
    } else if (callbacks.syncError) {
      callbacks.syncError(error)
    }
  }))

  unbind.push(sync.on('clientError', function (error) {
    if (callbacks.syncError) callbacks.syncError(error)
  }))

  unbind.push(sync.log.on('add', function (action, meta) {
    if (action.type === 'logux/undo' && action.reason) {
      if (action.reason === 'denied') {
        if (callbacks.denied) callbacks.denied(action, meta)
      } else if (callbacks.error) {
        callbacks.error(action, meta)
      }
    }
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = status
