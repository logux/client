import { Client, status } from '../index.js'

let client = new Client({
  server: 'ws://localhost',
  subprotocol: 10,
  userId: '10'
})

status(client, current => {
  document.title = current
})

status(client, (current, details) => {
  if (current === 'receiving') {
    document.title = `${(100 * details.done) / details.total}%`
  } else if (current === 'denied' || current === 'error') {
    document.title = details.action.type + details.meta.id
  } else if (current === 'syncError') {
    document.title = details.error.message
  } else {
    document.title = current
  }
})

status(client, (current, details) => {
  if (details?.type === 'error') {
    let message: string = details.message
    document.title = message
  } else if (details) {
    let done: number = details.done
    document.title = `${done}`
  }
})
