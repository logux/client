import { CrossTabClient } from '../index.js'

let client = new CrossTabClient({
  server: 'ws://localhost',
  subprotocol: 10,
  userId: '10'
})

client.on('preadd', (action, meta) => {
  console.log(action.type)
  meta.tab = client.tabId
})
