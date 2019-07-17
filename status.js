/**
 * Low-level function to show Logux synchronization status with your custom UI.
 * It is used in {@link badge} widget.
 *
 * @param {Client} client Observed Client instance.
 * @param {statusReceiver} callback Status callback.
 * @param {object} [options] Options.
 * @param {number} [options.duration=3000] `synchronizedAfterWait` duration.
 *
 * @return {Function} Unbind status listener.
 *
 * @example
 * import status from '@logux/client/status'
 * status(client, current => {
 *   updateUI(current)
 * })
 */
function status (client, callback, options) {
  var observable = client.on ? client : client.node
  var disconnected = observable.state === 'disconnected'
  var wait = false
  var old = false

  if (!options) options = { }
  if (typeof options.duration === 'undefined') options.duration = 3000

  var timeout
  var unbind = []
  var processing = { }

  function synchronized () {
    if (Object.keys(processing).length === 0) {
      if (wait) {
        wait = false
        callback('synchronizedAfterWait')
        timeout = setTimeout(function () {
          callback('synchronized')
        }, options.duration)
      } else {
        callback('synchronized')
      }
    }
  }

  unbind.push(observable.on('state', function () {
    clearTimeout(timeout)

    if (old) return
    if (observable.state === 'disconnected') {
      disconnected = true
      callback(wait ? 'wait' : 'disconnected')
    } else if (observable.state === 'synchronized') {
      disconnected = false
      synchronized()
    } else if (observable.state === 'connecting') {
      timeout = setTimeout(function () {
        callback('connecting' + (wait ? 'AfterWait' : ''))
      }, 100)
    } else {
      callback(client.state + (wait ? 'AfterWait' : ''))
    }
  }))

  unbind.push(client.node.on('error', function (error) {
    if (error.type === 'wrong-protocol' || error.type === 'wrong-subprotocol') {
      old = true
      callback('protocolError')
    } else if (error.type !== 'timeout') {
      callback('syncError', { error: error })
    }
  }))

  unbind.push(client.node.on('clientError', function (error) {
    callback('syncError', { error: error })
  }))

  var log = client.on ? client : client.log
  unbind.push(log.on('add', function (action, meta) {
    if (action.type === 'logux/subscribe') {
      return
    } else if (action.type === 'logux/unsubscribe') {
      return
    }

    if (action.type === 'logux/processed') {
      delete processing[action.id]
      synchronized()
    } else if (action.type === 'logux/undo') {
      delete processing[action.id]
    } else if (meta.sync) {
      processing[meta.id] = true
    }

    if (action.type === 'logux/undo' && action.reason) {
      if (action.reason === 'denied') {
        callback('denied', { action: action, meta: meta })
      } else {
        callback('error', { action: action, meta: meta })
      }
    } else if (disconnected && meta.sync && meta.added) {
      if (!wait) callback('wait')
      wait = true
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
 *          "synchronized"|"synchronizedAfterWait"|"disconnected"|"wait"|
 *          "connecting"|"connectingAfterWait"|"sending"|"syncError"|
 *          "error"|"denied"|"protocolError"
 *        } type Status type.
 * @param {object|undefined} details Status details.
 */
