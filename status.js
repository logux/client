/**
 * Low-level function to show Logux synchronization status with your custom UI.
 * It is used in {@link badge} widget.
 *
 * @param {Syncable|Client} client Observed Client instance
 *                                 or object with `sync` property.
 * @param {statusReceiver} callback Status callback.
 * @param {object} [options] Options.
 * @param {number} [options.duration=3000] `synchronizedAfterWait` duration.
 *
 * @return {Function} Unbind status listener.
 */
function status (client, callback, options) {
  var sync = client.sync
  var disconnected = sync.state === 'disconnected'
  var wait = false

  var timeout

  var unbind = []

  if (!options) options = { }
  if (typeof options.duration === 'undefined') options.duration = 3000

  unbind.push(sync.on('state', function () {
    clearTimeout(timeout)
    if (sync.state === 'disconnected') {
      disconnected = true
      callback(wait ? 'wait' : 'disconnected')
    } else if (sync.state === 'synchronized') {
      disconnected = false
      if (wait) {
        wait = false
        callback('synchronizedAfterWait')
        timeout = setTimeout(function () {
          callback('synchronized')
        }, options.duration)
      } else {
        callback('synchronized')
      }
    } else {
      callback(sync.state + (wait ? 'AfterWait' : ''))
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
    } else if (disconnected && meta.sync && meta.added) {
      wait = true
      callback('wait')
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
