import { parseId } from '@logux/core'

function bold(string) {
  return '%c' + string + '%c'
}

function showLog(text, details) {
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

export function log(client, messages = {}) {
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
          message = 'subscribing to ' + bold(action.channel) + ' channel'
          if (Object.keys(action).length === 2) {
            showLog(message)
          } else {
            showLog(message, { Action: action })
          }
        } else if (action.type === 'logux/subscribed') {
          showLog(
            'subscribed to ' + bold(action.channel) + ' channel by server'
          )
        } else if (action.type === 'logux/unsubscribe') {
          message = 'unsubscribed from channel ' + bold(action.channel)
          if (Object.keys(action).length === 2) {
            showLog(message)
          } else {
            showLog(message, { Action: action })
          }
        } else if (action.type === 'logux/processed') {
          if (sent[action.id]) {
            let processed = sent[action.id]
            let details = {
              'Processed Action': processed
            }
            if (processed.type === 'logux/subscribe') {
              showLog(
                'subscribed to ' + bold(processed.channel) + ' channel',
                details
              )
            } else {
              showLog(
                'action ' + bold(processed.type) + ' was processed',
                details
              )
            }
            delete sent[action.id]
          } else {
            showLog('action ' + bold(action.id) + ' was processed')
          }
        } else if (action.type === 'logux/undo') {
          if (action.action.type === 'logux/subscribe') {
            message = 'subscription to ' + bold(action.action.channel)
          } else {
            message = 'action ' + bold(action.action.type)
          }
          message += ' was undone because of ' + bold(action.reason)
          let details = {
            'Reverted Action': action.action
          }
          if (Object.keys(action).length > 4) {
            details['Undo Action'] = action
          }
          if (sent[action.id]) {
            delete sent[action.id]
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
