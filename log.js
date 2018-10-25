var browserSupportsLogStyles = require('browser-supports-log-styles')

function style (string) {
  return '%c' + string + '%c'
}

function colorify (color, text, action, meta) {
  text = '%cLogux:%c ' + text
  if (!color) text = text.replace(/%c/g, '')

  var args = [text]

  if (color) {
    var styles = text.match(/%c[^%]+%c/g)
    for (var i = 0; i < styles.length; i++) {
      if (i === 0) {
        args.push('color: #ffa200')
      } else {
        args.push('font-weight: bold')
      }
      args.push('')
    }
  }

  if (action && meta) {
    args.push(action)
    args.push(meta)
  }

  return args
}

/**
 * Display Logux events in browser console.
 *
 * @param {CrossTabClient} client Observed Client instance.
 * @param {object} [messages] Disable specific message types.
 * @param {boolean} [messages.state] Disable connection state messages.
 * @param {boolean} [messages.role] Disable tab role messages.
 * @param {boolean} [messages.error] Disable error messages.
 * @param {boolean} [messages.add] Disable action add messages.
 * @param {boolean} [messages.clean] Disable action clean messages.
 * @param {boolean} [messages.color] Disable colors in logs.
 * @param {string[]} [messages.ignoreActions] Disable action messages
 *                                            for specific types.
 *
 * @return {Function} Unbind log listener.
 *
 * @example
 * import log from 'logux-client/log'
 * log(client, { add: false })
 */
function log (client, messages) {
  if (!messages) messages = { }
  var node = client.node

  var color = messages.color !== false && browserSupportsLogStyles()

  function showLog (text, action, meta) {
    console.log.apply(console, colorify(color, text, action, meta))
  }

  function showError (error) {
    var text = 'error: ' + error.description
    if (error.received) text = 'server sent ' + text
    console.error.apply(console, colorify(color, text))
  }

  var unbind = []
  var prevConnected = false

  if (messages.state !== false) {
    unbind.push(client.on('state', function () {
      var postfix = ''

      if (client.state === 'connecting' && node.connection.url) {
        postfix = '. ' + style(node.localNodeId) + ' is connecting to ' +
                  style(node.connection.url) + '.'
      } else if (client.connected && !prevConnected && node.remoteNodeId) {
        postfix = '. Client was connected to ' + style(node.remoteNodeId) + '.'
        prevConnected = true
      } else if (!client.connected) {
        prevConnected = false
      }

      showLog('state was changed to ' + style(client.state) + postfix)
    }))
  }

  if (messages.role !== false) {
    unbind.push(client.on('role', function () {
      showLog('tab role was changed to ' + style(client.role))
    }))
  }

  if (messages.error !== false) {
    unbind.push(node.on('error', function (error) {
      showError(error)
    }))
    unbind.push(node.on('clientError', function (error) {
      showError(error)
    }))
  }

  var cleaned = { }
  var ignore = (messages.ignoreActions || []).reduce(function (all, i) {
    all[i] = true
    return all
  }, { })

  if (messages.add !== false) {
    unbind.push(client.on('add', function (action, meta) {
      if (meta.tab && meta.tab !== client.id) return
      if (ignore[action.type]) return
      var message = 'action ' + style(action.type) + ' was added'
      if (meta.reasons.length === 0) {
        cleaned[meta.id] = true
        message += ' and cleaned'
      }
      var nodeId = meta.id.split(' ')[1]
      if (nodeId !== node.localNodeId) {
        message += ' by ' + style(nodeId)
      }
      showLog(message, action, meta)
    }))
  }

  if (messages.clean !== false) {
    unbind.push(client.on('clean', function (action, meta) {
      if (cleaned[meta.id]) {
        delete cleaned[meta.id]
        return
      }
      if (meta.tab && meta.tab !== client.id) return
      if (ignore[action.type]) return
      var message = 'action ' + style(action.type) + ' was cleaned'
      showLog(message, action, meta)
    }))
  }

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = log
