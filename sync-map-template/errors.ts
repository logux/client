import {
  buildNewSyncMap,
  syncMapTemplate,
  changeSyncMap,
  createSyncMap,
  Client
} from '../index.js'

let client = new Client({
  subprotocol: '1.0.0',
  server: 'ws://localhost',
  userId: '10'
})

let User = syncMapTemplate<{
  name: string
  age?: number
}>('users')

let user = User('user:id', client)
// THROWS 'firstName' does not exist in type
changeSyncMap(user, { firstName: 'Ivan' })
// THROWS Type 'string' is not assignable to type 'number'
changeSyncMap(user, { age: '26' })
// THROWS 'id' does not exist in type
changeSyncMap(user, { id: '26' })
// THROWS firstName"' is not assignable to parameter of type '"name" | "age"
changeSyncMap(user, 'firstName', 'Ivan')
// THROWS 'string' is not assignable to parameter of type 'number'
changeSyncMap(user, 'age', '26')
// THROWS '"id"' is not assignable to parameter of type '"name" | "age"
changeSyncMap(user, 'id', '26')

// THROWS '{ name: string; }' is not assignable to parameter
let user1 = createSyncMap(client, User, { name: 'A' })
// THROWS 'string' is not assignable to type 'number'
let user2 = createSyncMap(client, User, { id: 'user:2', name: 'B', age: '12' })
// THROWS '{ id: string; }' is not assignable to parameter
let user3 = buildNewSyncMap(client, User, { id: 'user:3' })
