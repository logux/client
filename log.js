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
 * @param {object} [messages] Disable specific message types.
 * @param {boolean} [messages.connect] Disable connect messages.
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
function log (sync, messages) {
  if (sync.sync) sync = sync.sync
  if (!messages) messages = { }

  var unbind = []

  if (messages.connect !== false) {
    unbind.push(sync.on('connect', function () {
      var url = false
      var con = sync.connection
      var message = 'Logux ' + sync.localNodeId +
                    ' was connected to ' + sync.remoteNodeId

      if (con.url) {
        url = con.url
      } else if (typeof con.connection !== 'undefined' && con.connection.url) {
        url = con.connection.url
      }
      if (url) message += ' at ' + url
      console.log(message)
    }))
  }

  if (messages.state !== false) {
    unbind.push(sync.on('state', function () {
      console.log('Logux change state to ' + sync.state)
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
