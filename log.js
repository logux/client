function showError (error) {
  var message = 'Logux '
  if (error.received) message += 'server sent '
  message += 'error: ' + error.description
  console.error(message)
}

/**
 * Display Logux events in browser console.
 *
 * @param {Syncable|BaseSync} sync Observed Sync instance.
 *
 * @return {Function} Unbind log listener.
 *
 * @example
 * import log from 'logux-status/log'
 * log(client)
 */
function log (sync) {
  if (sync.sync) sync = sync.sync

  var unbind = []

  unbind.push(sync.on('connect', function () {
    var url = false
    var conn = sync.connection
    var message = 'Logux ' + sync.localNodeId +
                  ' was connected to ' + sync.remoteNodeId

    if (conn.url) {
      url = conn.url
    } else if (typeof conn.connection !== 'undefined' && conn.connection.url) {
      url = conn.connection.url
    }
    if (url) message += ' at ' + url
    console.log(message)
  }))

  unbind.push(sync.on('state', function () {
    console.log('Logux change state to ' + sync.state)
  }))

  unbind.push(sync.on('error', function (error) {
    showError(error)
  }))

  unbind.push(sync.on('clientError', function (error) {
    showError(error)
  }))

  unbind.push(sync.log.on('add', function (action, meta) {
    var message
    if (meta.id[1] === sync.localNodeId) {
      message = 'Action ' + action.type + ' was added to Logux'
    } else {
      message = meta.id[1] + ' added action ' + action.type + ' to Logux'
    }
    console.log(message, action, meta)
  }))

  unbind.push(sync.log.on('clean', function (action, meta) {
    var type = action.type
    console.log('Action ' + type + ' was cleaned from Logux', action, meta)
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = log
