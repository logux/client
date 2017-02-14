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
    if (error.received && sync.remoteNodeId) {
      message += sync.remoteNodeId + ' sent '
    } else {
      message += sync.localNodeId + ' received '
    }
    message += error.type + ' error'
    if (error.description !== error.type) {
      message += ' (' + error.description + ')'
    }
    return message
  }

  unbind.push(sync.on('connect', function () {
    console.log('Logux ' + sync.localNodeId + ' was connected')
  }))

  unbind.push(sync.on('state', function () {
    console.log(
      'Logux ' + sync.localNodeId +
      ' changed synchronization state to ' + sync.state)
  }))

  unbind.push(sync.on('error', function (error) {
    console.log(prepareError(error))
  }))

  unbind.push(sync.on('clientError', function (error) {
    console.log(prepareError(error))
  }))

  unbind.push(sync.log.on('add', function (action) {
    console.log(
      'Logux ' + sync.localNodeId + ' added new action \'' +
      action.type + '\' to log')
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = log
