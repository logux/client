import { CrossTabClient } from '..'

let app = new CrossTabClient({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: '10'
})

app.on('preadd', (action, meta) => {
  console.log(action.type)
  meta.tab = app.tabId
})
