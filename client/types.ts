import { Client } from '..'

let app = new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: false
})

app.log.add({ type: 'A' }, { extra: 1 })
