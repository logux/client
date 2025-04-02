import {
  buildNewSyncMap,
  changeSyncMap,
  Client,
  createSyncMap,
  ensureStoreLoaded,
  syncMapTemplate
} from '../index.js'

let client = new Client({
  server: 'ws://localhost',
  subprotocol: '1.0.0',
  userId: '10'
})

let User = syncMapTemplate<{
  age?: number
  name: string
}>('users')

let user = User('user:id', client)
changeSyncMap(user, { name: 'Ivan' })
changeSyncMap(user, 'name', 'Ivan')
changeSyncMap(user, 'age', 26)

createSyncMap(client, User, { id: 'user:1', name: 'A' })
buildNewSyncMap(client, User, { age: 12, id: 'user:2', name: 'B' })

console.log(ensureStoreLoaded(user).get().name)
