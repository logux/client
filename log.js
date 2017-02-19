function showError (error) {
  var message = 'Logux '
  if (error.received) message += 'server sent '
  message += 'error: ' + error.description
  console.error(message)
}

/**
 * Display Logux events in browser console.
 *
 * @param {Syncable|Client} client Observed Client instance
 *                                 or object with `sync` property.
 * @param {object} [messages] Disable specific message types.
 * @param {boolean} [messages.state] Disable state messages.
 * @param {boolean} [messages.error] Disable error messages.
 * @param {boolean} [messages.add] Disable add messages.
 * @param {boolean} [messages.clean] Disable clean messages.
 *
 * @return {Function} Unbind log listener.
 *
 * @example
 * import log from 'logux-status/log'
 * log(client, { add: false })
 */
function log (client, messages) {
  if (!messages) messages = { }
  var sync = client.sync

  var unbind = []
  var prevConnected = false

  if (messages.state !== false) {
    unbind.push(sync.on('state', function () {
      var postfix = ''

      if (sync.state === 'connecting' && sync.connection.url) {
        postfix = '. ' + sync.localNodeId + ' is connecting to ' +
                  sync.connection.url + '.'
      }

      if (sync.connected && !prevConnected) {
        postfix = '. Client was connected to ' + sync.remoteNodeId + '.'
        prevConnected = true
      } else if (!sync.connected) {
        prevConnected = false
      }

      console.log('Logux change state to ' + sync.state + postfix)
    }))
  }

  if (messages.error !== false) {
    unbind.push(sync.on('error', function (error) {
      showError(error)
    }))
    unbind.push(sync.on('clientError', function (error) {
      showError(error)
    }))
  }

  if (messages.add !== false) {
    unbind.push(sync.log.on('add', function (action, meta) {
      var message
      if (meta.id[1] === sync.localNodeId) {
        message = 'Action ' + action.type + ' was added to Logux'
      } else {
        message = meta.id[1] + ' added action ' + action.type + ' to Logux'
      }
      console.log(message, action, meta)
    }))
  }

  if (messages.clean !== false) {
    unbind.push(sync.log.on('clean', function (action, meta) {
      var type = action.type
      console.log('Action ' + type + ' was cleaned from Logux', action, meta)
    }))
  }

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = log
