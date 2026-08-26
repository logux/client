import { zeroPacker } from '@logux/actions'
import { openDb } from '@nanostores/sql'
import { nodeDriver } from '@nanostores/sql/node'

import { SqlLogStore } from '../db.js'
import { CrossTabClient } from '../index.js'

let db = openDb(nodeDriver('app.sqlite'))
let store = new SqlLogStore(db, {
  packers: {
    // THROWS ZeroAction
    '0/clean': zeroPacker
  }
})
