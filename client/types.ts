import { Action } from '@logux/core'
import { Client } from '..'

let app = new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: '10'
})

app.log.add({ type: 'A' }, { extra: 1 })

type UserRenameAction = Action & {
  type: 'user/rename',
  userId: string,
  name: string
}

function isUserRename (action): action is UserRenameAction {
  return action.type === 'user/rename'
}

app.log.on('add', action => {
  if (isUserRename(action)) {
    document.title = action.name
  }
})
