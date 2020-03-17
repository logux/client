import { CrossTabClient } from '..'

let app = new CrossTabClient({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: false
})

app.on('preadd', (action, meta) => {
  // THROWS Type '1' is not assignable to type 'string'.
  action.type = 1
  // THROWS Type '1' is not assignable to type 'string | undefined'.
  meta.tab = 1
})

// THROWS No overload matches this call.
app.on('state', action => {
  console.log(action.type)
})
