/**
 * Low-level function to show Logux synchronization status with your custom UI.
 * It is used in {@link badge} widget.
 *
 * @param {Client} client Observed Client instance.
 * @param {statusReceiver} callback Status callback.
 * @param {object} [options] Options.
 * @param {number} [options.duration=3000] `synchronizedAfterWait` duration.
 *
 * @return {function} Unbind status listener.
 *
 * @example
 * import status from '@logux/client/status'
 * status(client, current => {
 *   updateUI(current)
 * })
 */
function status (client, callback, options = { }) {
  let observable = client.on ? client : client.node
  let disconnected = observable.state === 'disconnected'
  let wait = false
  let old = false

  if (typeof options.duration === 'undefined') options.duration = 3000

  let timeout
  let unbind = []
  let processing = { }

  let synchronized = () => {
    if (Object.keys(processing).length === 0) {
      if (wait) {
        wait = false
        callback('synchronizedAfterWait')
        timeout = setTimeout(() => {
          callback('synchronized')
        }, options.duration)
      } else {
        callback('synchronized')
      }
    }
  }

  unbind.push(observable.on('state', () => {
    clearTimeout(timeout)

    if (old) return
    if (observable.state === 'disconnected') {
      disconnected = true
      callback(wait ? 'wait' : 'disconnected')
    } else if (observable.state === 'synchronized') {
      disconnected = false
      synchronized()
    } else if (observable.state === 'connecting') {
      timeout = setTimeout(() => {
        callback('connecting' + (wait ? 'AfterWait' : ''))
      }, 100)
    } else {
      callback(client.state + (wait ? 'AfterWait' : ''))
    }
  }))

  unbind.push(client.node.on('error', error => {
    if (error.type === 'wrong-protocol' || error.type === 'wrong-subprotocol') {
      old = true
      callback('protocolError')
    } else if (error.type !== 'timeout') {
      callback('syncError', { error })
    }
  }))

  unbind.push(client.node.on('clientError', error => {
    callback('syncError', { error })
  }))

  let log = client.on ? client : client.log
  unbind.push(log.on('add', (action, meta) => {
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
        callback('denied', { action, meta })
      } else {
        callback('error', { action, meta })
      }
    } else if (disconnected && meta.sync && meta.added) {
      if (!wait) callback('wait')
      wait = true
    }
  }))

  return () => {
    for (let i of unbind) i()
  }
}

module.exports = { status }

/**
 * @callback statusReceiver
 * @param {
 *   "synchronized"|"synchronizedAfterWait"|"disconnected"|"wait"|"error"|
 *   "connecting"|"connectingAfterWait"|"syncError"|"denied"|"protocolError"
 * } type Status type.
 * @param {object|undefined} details Status details.
 */
