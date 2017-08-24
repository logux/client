/**
 * Low-level function to show Logux synchronization status with your custom UI.
 * It is used in {@link badge} widget.
 *
 * @param {Syncable|Client} client Observed Client instance
 *                                 or object with `sync` property.
 * @param {statusReceiver} callback Status callback.
 *
 * @return {Function} Unbind status listener.
 */
function status (client, callback) {
  var sync = client.sync
  var wait = sync.state === 'wait'

  var unbind = []

  unbind.push(sync.on('state', function () {
    if (sync.state === 'wait') {
      wait = true
    } else {
      wait = false
      callback(sync.state)
    }
  }))

  unbind.push(sync.on('error', function (error) {
    if (error.type === 'wrong-protocol' || error.type === 'wrong-subprotocol') {
      callback('protocolError')
    } else {
      callback('syncError', { error: error })
    }
  }))

  unbind.push(sync.on('clientError', function (error) {
    callback('syncError', { error: error })
  }))

  unbind.push(sync.log.on('add', function (action, meta) {
    if (action.type === 'logux/undo' && action.reason) {
      if (action.reason === 'denied') {
        callback('denied', { action: action, meta: meta })
      } else {
        callback('error', { action: action, meta: meta })
      }
    } else if (wait && meta.sync && meta.added) {
      callback('waitSync')
    }
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = status

/**
 * @callback statusReceiver
 * @param {
 *          "synchronized"|"disconnected"|"wait"|"connecting"|"sending"|
 *          "syncError"|"error"|"denied"|"protocolError"
 *        } type Status type.
 * @param {object|undefined} details Status details.
 */
