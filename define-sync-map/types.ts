import {
  buildNewSyncMap,
  defineSyncMap,
  changeSyncMap,
  createSyncMap,
  Client
} from '../index.js'

let client = new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: '10'
})

let User =
  defineSyncMap<{
    name: string
    age?: number
  }>('users')

let user = User('user:id', client)
changeSyncMap(user, { name: 'Ivan' })
changeSyncMap(user, 'name', 'Ivan')
changeSyncMap(user, 'age', 26)

createSyncMap(client, User, { id: 'user:1', name: 'A' })
buildNewSyncMap(client, User, { id: 'user:2', name: 'B', age: 12 })
