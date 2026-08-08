import { openDb } from '@nanostores/sql'
import { nodeDriver } from '@nanostores/sql/node'

import { SqlLogStore } from '../db.js'
import { CrossTabClient } from '../index.js'

let db = openDb(nodeDriver('app.sqlite'))
let store = new SqlLogStore(db)

let client = new CrossTabClient({
  server: 'ws://localhost',
  store,
  subprotocol: 10,
  userId: '10'
})

client.log.add({ type: 'A' }, { reasons: ['test'] })

console.log(await store.getLastAdded())
