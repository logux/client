import { LoguxUndoError } from '../logux-undo-error/index.js'
import { Client } from '../client/index.js'

export function request (action, opts) {
  if (!opts.userId) opts.userId = 'anonymous'
  let client = new Client(opts)
  return new Promise((resolve, reject) => {
    client.node.catch(e => {
      client.destroy()
      reject(e)
    })
    client.on('add', response => {
      if (response === action) return
      client.destroy()
      if (response.type === 'logux/undo') {
        reject(new LoguxUndoError(response))
      } else {
        resolve(response)
      }
    })
    client.log.add(action, { sync: true })
    client.start()
  })
}
