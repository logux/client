/**
 * Logger.
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

  function prepareError (error) {
    var message = 'Logux '
    if (error.received) message += 'server sent '
    message += 'error: ' + error.description
    return message
  }

  unbind.push(sync.on('connect', function () {
    var url = false
    var conn = sync.connection
    var message = 'Logux ' + sync.localNodeId +
                  ' are connected to ' + sync.remoteNodeId

    if (conn.url) {
      url = conn.url
    } else if (typeof conn.connection !== 'undefined' && conn.connection.url) {
      url = conn.connection.url
    }
    if (url) message += ' at url ' + url
    console.log(message)
  }))

  unbind.push(sync.on('state', function () {
    console.log('Logux change state to ' + sync.state)
  }))

  unbind.push(sync.on('error', function (error) {
    console.log(prepareError(error))
  }))

  unbind.push(sync.on('clientError', function (error) {
    console.log(prepareError(error))
  }))

  unbind.push(sync.log.on('add', function (action, meta) {
    var message
    if (meta.id[1] === sync.localNodeId) {
      message = action.type + ' action was added to Logux:'
    } else {
      message = meta.id[1] + ' added ' + action.type + ' action to Logux:'
    }
    console.log(message, action, meta)
  }))

  unbind.push(sync.log.on('clean', function (action, meta) {
    var message
    if (meta.id[1] === sync.localNodeId) {
      message = action.type + ' action was cleaned from Logux:'
    } else {
      message = meta.id[1] + ' clean ' + action.type + ' action from Logux:'
    }
    console.log(message, action, meta)
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = log
