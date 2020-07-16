import { Client } from '../index.js'

let client = new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: '10'
})

// THROWS Type 'number' is not assignable to type 'string | undefined'.
client.log.add({ type: 'A' }, { tab: 1 })

new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  // THROWS Type 'false' is not assignable to type 'string'.
  userId: false
})
