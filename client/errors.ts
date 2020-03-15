import { Client } from '..'

let app = new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: false
})

// THROWS Type 'number' is not assignable to type 'string | undefined'.
app.log.add({ type: 'A' }, { tab: 1 })
