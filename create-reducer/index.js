import { atom } from 'nanostores'

let storageTracking = false
let storageListeners = {}

function startStorageTracking(key, callback) {
  storageListeners[key] = callback
  if (!storageTracking) {
    storageTracking = true
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', event => {
        if (event.newValue) {
          let cb = storageListeners[event.key]
          if (cb) cb(parseInt(event.newValue, 10))
        }
      })
    }
  }
}

export function createReducer(client, name, version, callbacks) {
  let clean = callbacks.clean ?? (() => {})
  let init = callbacks.init ?? (() => {})
  let stop = callbacks.stop ?? (() => {})

  let status = atom('initializing')

  let actionsWaiting = []
  let actionListeners = {}

  let promise = Promise.resolve()
  function ready() {
    for (let entry of actionsWaiting) {
      let listener = actionListeners[entry[0].type]
      if (listener) {
        promise = promise.then(() => listener(entry[0], entry[1]))
      }
    }
    actionsWaiting = []
    status.set('ready')
  }

  let key = `logux:reducer:${name}`
  let oldStorage = localStorage.getItem(key)
  if (!oldStorage) {
    localStorage.setItem(key, version)
    let initializing = init() ?? Promise.resolve()
    initializing.then(ready)
  } else {
    let oldVersion = parseInt(oldStorage, 10)
    if (oldVersion < version) {
      status.set('updating')
      let cleaning = clean(oldVersion) ?? Promise.resolve()
      cleaning.then(async entries => {
        await init()
        for (let entry of entries ?? []) {
          let listener = actionListeners[entry[0].type]
          if (listener) await listener(entry[0], entry[1])
        }
        ready()
      })
    } else if (oldVersion > version) {
      status.set('outdated')
      stop()
    } else {
      ready()
    }
  }

  startStorageTracking(key, newVersion => {
    if (newVersion > version) {
      status.set('outdated')
      stop()
    }
  })

  client.on('add', (action, meta) => {
    let listener = actionListeners[action.type]
    if (listener) {
      if (status.get() !== 'ready') {
        actionsWaiting.push([action, meta])
      } else {
        promise = promise.then(() => listener(action, meta))
      }
    }
  })

  let reducer = {
    status,
    type(type, listener) {
      if (typeof type !== 'string') type = type.type
      actionListeners[type] = listener
    }
  }

  return reducer
}
