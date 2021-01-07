let { LoguxUndoError } = require('../logux-undo-error')
let { Client } = require('../client')

function request (action, opts) {
  if (!opts.userId) opts.userId = 'anonymous'
  let client = new Client(opts)
  return new Promise((resolve, reject) => {
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

module.exports = { request }
