var browserSupportsLogStyles = require('browser-supports-log-styles')

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
 * @param {boolean} [messages.color] Disable colors in logs.
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
  var colorsEnabled = true
  var stylePrefix = '%c'
  var boldStyle = 'font-weight: bold'

  if (messages.color === false || !browserSupportsLogStyles()) {
    colorsEnabled = false
    boldStyle = ''
    stylePrefix = ''
  }

  if (messages.state !== false) {
    unbind.push(sync.on('state', function () {
      var postfix = ''
      var nodeIdString = ''
      var syncStateString = stylePrefix + sync.state + stylePrefix
      var connectionUrlString = stylePrefix + sync.connection.url + stylePrefix
      var stylesCount = 1

      if (sync.state === 'connecting' && sync.connection.url) {
        nodeIdString = stylePrefix + sync.localNodeId + stylePrefix
        postfix = '. ' + nodeIdString + ' is connecting to ' +
                  connectionUrlString + '.'
        stylesCount += 2
      }

      if (sync.connected && !prevConnected) {
        nodeIdString = stylePrefix + sync.remoteNodeId + stylePrefix
        postfix = '. Client was connected to ' + nodeIdString + '.'
        prevConnected = true
        stylesCount++
      } else if (!sync.connected) {
        prevConnected = false
      }

      var args = ['log', 'state was changed to ' + syncStateString + postfix]
      if (colorsEnabled) {
        for (var i = 0; i < stylesCount; i++) {
          args.push(boldStyle, '')
        }
      }

      showMessage.apply(log, args)
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
      var type = stylePrefix + action.type + stylePrefix
      var stylesCount = 1
      if (meta.id[1] === sync.localNodeId) {
        message = 'action ' + type + ' was added'
      } else {
        var metaString = stylePrefix + meta.id[1] + stylePrefix
        message = 'action ' + type + ' was added by ' + metaString
        stylesCount++
      }

      var args = ['log', message]
      if (colorsEnabled) {
        for (var i = 0; i < stylesCount; i++) {
          args.push(boldStyle, '')
        }
      }
      args.push(action, meta)

      showMessage.apply(log, args)
    }))
  }

  if (messages.clean !== false) {
    unbind.push(sync.log.on('clean', function (action, meta) {
      var type = stylePrefix + action.type + stylePrefix
      showMessage(
        'log',
        'action ' + type + ' was cleaned',
        boldStyle, '', action, meta
      )
    }))
  }

  function showMessage (type) {
    var args = Array.prototype.slice.call(arguments, 1)

    if (colorsEnabled) {
      args[0] = '%cLogux:%c ' + args[0]
      args.splice(1, 0, 'color: #ffa200')
      args.splice(2, 0, '')
    } else {
      args[0] = 'Logux: ' + args[0]
    }

    console[type].apply(console, args)
  }

  function showError (error) {
    var message = ''
    if (error.received) message += 'server sent '
    message += 'error: ' + error.description
    showMessage('error', message)
  }

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = log
