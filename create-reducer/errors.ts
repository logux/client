import { Client, createStorageReducer } from '../index.js'

let client = new Client({
  server: 'ws://localhost',
  subprotocol: 10,
  userId: '10'
})

// THROWS No overload matches this call.
createStorageReducer(client, 'counter', 1, 0, {
  repeat() {
    return []
  }
})

let stringReducer = createStorageReducer(client, 'name', 1, '', {
  repeat() {
    return []
  }
})
// THROWS No overload matches this call
stringReducer.type<{ type: 'set' }>('set', () => {
  return 1
})

let numberReducer = createStorageReducer(client, 'counter', 1, 0, {
  decode: s => parseInt(s, 10),
  encode: v => String(v),
  repeat() {
    return []
  }
})
// THROWS No overload matches this call
numberReducer.type<{ type: 'inc' }>('inc', () => {
  return 'x'
})
