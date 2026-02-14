export function status(client, callback, options = {}) {
  let observable = client.on ? client : client.node
  let disconnected = observable.state === 'disconnected'
  let wait = false
  let error = false

  if (typeof options.duration === 'undefined') options.duration = 3000

  let timeout
  let unbind = []
  let processing = {}

  function setSynchronized() {
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

  function changeState() {
    clearTimeout(timeout)

    if (observable.state === 'disconnected') {
      disconnected = true
      if (!error) callback(wait ? 'wait' : 'disconnected')
    } else if (observable.state === 'synchronized') {
      error = false
      disconnected = false
      setSynchronized()
    } else if (observable.state === 'connecting') {
      if (!error) {
        timeout = setTimeout(() => {
          callback('connecting' + (wait ? 'AfterWait' : ''))
        }, 100)
      }
    } else if (!error) {
      callback(client.state + (wait ? 'AfterWait' : ''))
    }
  }

  unbind.push(observable.on('state', changeState))

  unbind.push(
    client.node.on('error', e => {
      if (e.type === 'wrong-protocol' || e.type === 'wrong-subprotocol') {
        error = true
        callback('protocolError')
      } else if (e.type === 'wrong-credentials') {
        error = true
        callback('wrongCredentials')
      } else if (e.type !== 'timeout') {
        error = true
        callback('syncError', { error: e })
      }
    })
  )

  unbind.push(
    client.node.on('clientError', e => {
      callback('syncError', { error: e })
    })
  )

  let log = client.on ? client : client.log
  unbind.push(
    log.on('add', (action, meta) => {
      if (action.type === 'logux/subscribe') {
        return
      } else if (action.type === 'logux/unsubscribe') {
        return
      }

      if (action.type === 'logux/processed') {
        delete processing[action.id]
        setSynchronized()
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
    })
  )

  changeState()

  return () => {
    for (let i of unbind) i()
  }
}
