import { defineAction } from '@logux/actions'
import type { Action } from '@logux/core'

import { Client } from '../index.js'

let client = new Client({
  server: 'ws://localhost',
  subprotocol: '1.0.0',
  userId: '10'
})

client.log.add({ type: 'A' }, { extra: 1 })

type UserRenameAction = {
  name: string
  type: 'user/rename'
  userId: string
} & Action

let userRename = defineAction<UserRenameAction>('user/rename')

client.type<UserRenameAction>('user/rename', action => {
  document.title = action.name
})

client.type(userRename, action => {
  document.title = action.name
})
