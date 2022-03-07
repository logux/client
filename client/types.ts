import { defineAction } from '@logux/actions'
import { Action } from '@logux/core'

import { Client } from '../index.js'

let client = new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: '10'
})

client.log.add({ type: 'A' }, { extra: 1 })

type UserRenameAction = Action & {
  type: 'user/rename'
  userId: string
  name: string
}

let userRename = defineAction<UserRenameAction>('user/rename')

client.type<UserRenameAction>('user/rename', action => {
  document.title = action.name
})

client.type(userRename, action => {
  document.title = action.name
})
