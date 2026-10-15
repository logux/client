import { defineAction } from '@logux/actions'
import { Action } from '@logux/core'

import { Client } from '../index.js'

let client = new Client({
  subprotocol: 10,
  server: 'ws://localhost',
  userId: '10'
})

// THROWS Type 'number' is not assignable to type 'string'
client.log.add({ type: 'A' }, { tab: 1 })

new Client({
  subprotocol: 10,
  server: 'ws://localhost',
  // THROWS Type 'boolean' is not assignable to type 'string'.
  userId: false
})

type RenameAction = Action & {
  type: 'rename'
  name: string
}

let userRename = defineAction<RenameAction>('rename')

// THROWS '"rename2"' is not assignable to parameter of type '"rename"'
client.type<RenameAction>('rename2', action => {
  document.title = action.name
})

client.type<RenameAction>('rename', action => {
  // THROWS 'fullName' does not exist on type 'RenameAction'
  document.title = action.fullName
})

client.type(userRename, action => {
  // THROWS 'fullName' does not exist on type 'RenameAction'
  document.title = action.fullName
})

function subscribeWrong(): void {
  // THROWS 'number' is not assignable to parameter of type 'string'
  client.subscribe(1)
  // THROWS Object literal may only specify known properties
  client.subscribe('users/1', { type: 'logux/subscribe' })
  // THROWS Expected 0 arguments, but got 1
  client.subscribe('users/1')(1)
  // THROWS 'string' is not assignable to type 'Promise<void>'
  client.subscribe('users/1').loading = 'done'
}
subscribeWrong()
