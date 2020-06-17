let { parseId } = require('@logux/core/parse-id')

function bold (string) {
  return '%c' + string + '%c'
}

function showLog (text, details) {
  text = '%cLogux%c ' + text
  let args = Array.from(text.match(/%c/g)).map((_, i) => {
    if (i === 0) {
      return 'color:#ffa200;font-weight:bold'
    } else if (i % 2 === 0) {
      return 'font-weight:bold'
    } else {
      return 'font-weight:normal'
    }
  })

  if (details) {
    console.groupCollapsed(text, ...args)
    for (let name in details) {
      if (typeof details[name] === 'string') {
        console.log(name + ': %c' + details[name], 'font-weight:bold')
      } else {
        console.log(name, details[name])
      }
    }
    console.groupEnd()
  } else {
    console.log(text, ...args)
  }
}

function log (client, messages = {}) {
  let node = client.node

  let sent = {}
  let unbind = []
  let prevConnected = false

  if (messages.state !== false) {
    unbind.push(
      client.on('state', () => {
        let details
        if (client.state === 'connecting' && node.connection.url) {
          details = {
            'Node ID': node.localNodeId,
            'Server': node.connection.url
          }
        } else if (client.connected && !prevConnected && node.remoteNodeId) {
          prevConnected = true
          details = {
            'Server ID': node.remoteNodeId
          }
        } else if (!client.connected) {
          prevConnected = false
        }
        showLog('state is ' + bold(client.state), details)
      })
    )
  }

  if (messages.role !== false) {
    unbind.push(
      client.on('role', () => {
        showLog('tab role is ' + bold(client.role))
      })
    )
  }

  let cleaned = {}
  let ignore = (messages.ignoreActions || []).reduce((all, i) => {
    all[i] = true
    return all
  }, {})

  if (messages.add !== false) {
    unbind.push(
      client.on('add', (action, meta) => {
        if (meta.tab && meta.tab !== client.tabId) return
        if (ignore[action.type]) return
        if (meta.sync) sent[meta.id] = action
        let message
        if (action.type === 'logux/subscribe') {
          message = 'subscribed to channel ' + bold(action.channel)
          if (Object.keys(action).length === 2) {
            showLog(message)
          } else {
            showLog(message, { Action: action })
          }
        } else if (action.type === 'logux/unsubscribe') {
          message = 'unsubscribed from channel ' + bold(action.channel)
          if (Object.keys(action).length === 2) {
            showLog(message)
          } else {
            showLog(message, { Action: action })
          }
        } else if (action.type === 'logux/processed') {
          if (sent[action.id]) {
            showLog('action ' + bold(sent[action.id].type) + ' was processed', {
              'Processed Action': sent[action.id]
            })
            delete sent[action.id]
          } else {
            showLog('action ' + bold(action.id) + ' was processed')
          }
        } else if (action.type === 'logux/undo') {
          message =
            'action ' +
            bold(action.id) +
            ' was undid because of ' +
            bold(action.reason)
          let details = {}
          if (sent[action.id]) {
            details.Action = sent[action.id]
            delete sent[action.id]
          }
          if (Object.keys(action).length > 3) {
            details.Undo = action
          }
          showLog(message, details)
        } else {
          let details = { Action: action, Meta: meta }
          message = 'added '
          if (meta.reasons.length === 0) {
            cleaned[meta.id] = true
            message += 'and cleaned '
          }
          message += bold(action.type) + ' action'
          let { nodeId } = parseId(meta.id)
          if (nodeId !== node.localNodeId) {
            details.From = nodeId
          }
          showLog(message, details)
        }
      })
    )
  }

  if (messages.user !== false) {
    unbind.push(
      client.on('user', userId => {
        let message = 'user ID was changed to ' + bold(userId)
        showLog(message, { 'Node ID': client.nodeId })
      })
    )
  }

  if (messages.clean !== false) {
    unbind.push(
      client.on('clean', (action, meta) => {
        if (cleaned[meta.id]) {
          delete cleaned[meta.id]
          return
        }
        if (meta.tab && meta.tab !== client.id) return
        if (ignore[action.type]) return
        if (action.type.startsWith('logux/')) return
        let message = 'cleaned ' + bold(action.type) + ' action'
        showLog(message, { Action: action, Meta: meta })
      })
    )
  }

  return () => {
    for (let i of unbind) i()
  }
}

module.exports = { log }
