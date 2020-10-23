import { Action } from '@logux/core'

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
  // THROWS Type 'boolean' is not assignable to type 'string'.
  userId: false
})

type RenameAction = Action & {
  type: 'rename'
  name: string
}

// THROWS '"rename2"' is not assignable to parameter of type '"rename"'
client.type<RenameAction>('rename2', action => {
  document.title = action.name
})

client.type<RenameAction>('rename', action => {
  // THROWS 'fullName' does not exist on type 'RenameAction'
  document.title = action.fullName
})
