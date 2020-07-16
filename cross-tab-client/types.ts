import { CrossTabClient } from '../index.js'

let client = new CrossTabClient({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: '10'
})

client.on('preadd', (action, meta) => {
  console.log(action.type)
  meta.tab = client.tabId
})
