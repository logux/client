import { Client } from '..'

let app = new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: '10'
})

// THROWS Type 'number' is not assignable to type 'string | undefined'.
app.log.add({ type: 'A' }, { tab: 1 })

new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  // THROWS Type 'false' is not assignable to type 'string'.
  userId: false
})
