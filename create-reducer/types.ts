import { defineAction } from '@logux/actions'
import type { Action } from '@logux/core'

import {
  Client,
  createReducer,
  createStorageReducer,
  type PersistentStorage
} from '../index.js'

let client = new Client({
  server: 'ws://localhost',
  subprotocol: 10,
  userId: '10'
})

let reducer = createReducer(client, 'db', 1, {
  clean() {},
  init() {},
  migrating(done) {
    void done.then(() => {})
  },
  stop() {}
})

async function testReady(): Promise<void> {
  await reducer.ready
  let status: 'initializing' | 'migrating' | 'outdated' | 'ready' =
    reducer.status.get()
  console.log(status)
}
testReady()

reducer.type('users/create', action => {
  document.title = action.type
})

type RenameAction = {
  name: string
  type: 'user/rename'
} & Action

let userRename = defineAction<RenameAction>('user/rename')

reducer.type<RenameAction>('user/rename', action => {
  document.title = action.name
})

reducer.type(userRename, action => {
  document.title = action.name
})

let stringReducer = createStorageReducer(client, 'name', 1, '', {
  migrating(done) {
    void done.then(() => {})
  },
  repeat() {
    return []
  }
})
void stringReducer.ready.then(() => {})
stringReducer.type<{ type: 'set'; value: string }>('set', (_prev, action) => {
  return action.value
})
let stringValue: string = stringReducer.value.get()
console.log(stringValue)

let unionReducer = createStorageReducer<'off' | 'on'>(
  client,
  'toggle',
  1,
  'off',
  {
    repeat() {
      return []
    }
  }
)
unionReducer.type<{ type: 'toggle' }>('toggle', prev => {
  return prev === 'on' ? 'off' : 'on'
})
let unionValue: 'off' | 'on' = unionReducer.value.get()
console.log(unionValue)

let numberReducer = createStorageReducer(client, 'counter', 1, 0, {
  decode: s => parseInt(s, 10),
  encode: v => String(v),
  repeat() {
    return []
  }
})
numberReducer.type<{ type: 'inc' }>('inc', prev => prev + 1)
let numberValue: number = numberReducer.value.get()
console.log(numberValue)

interface Settings {
  notifications: boolean
  theme: string
}
let objectReducer = createStorageReducer<Settings>(
  client,
  'settings',
  1,
  { notifications: true, theme: 'dark' },
  {
    decode: s => JSON.parse(s),
    encode: v => JSON.stringify(v),
    repeat() {
      return []
    }
  }
)
objectReducer.type<{ theme: string; type: 'theme' }>(
  'theme',
  (prev, action) => {
    return { ...prev, theme: action.theme }
  }
)
let objectValue: Settings = objectReducer.value.get()
console.log(objectValue)

let memoryStorage: PersistentStorage = {}

let memoryReducer = createReducer(client, 'memory', 1, {
  clean() {},
  storage: memoryStorage
})
memoryReducer.type('users/create', action => {
  document.title = action.type
})

let memoryValue = createStorageReducer(client, 'memory-value', 1, '', {
  repeat() {
    return []
  },
  storage: localStorage
})
console.log(memoryValue.value.get())
