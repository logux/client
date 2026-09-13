import { Client, status } from '../index.js'

let client = new Client({
  server: 'ws://localhost',
  subprotocol: 10,
  userId: '10'
})

status(client, (current, details) => {
  if (current === 'receiving') {
    // THROWS Property 'error' does not exist on type 'StatusReceiving'
    console.log(details.error)
  }
})

status(client, current => {
  // THROWS and '"unknown"' have no overlap
  if (current === 'unknown') {
    console.log(current)
  }
})
