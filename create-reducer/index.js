import { atom } from 'nanostores'

let storageTracking = false
let storageListeners = {}

function startStorageTracking(key, callback) {
  storageListeners[key] = callback
  if (!storageTracking) {
    storageTracking = true
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', event => {
        if (event.newValue !== null) {
          let cb = storageListeners[event.key]
          if (cb) cb(event.newValue)
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

  let isLeader = false
  let releaseLock = () => {}

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
    let initializing = init() ?? Promise.resolve()
    initializing
      .then(() => {
        localStorage.setItem(key, String(version))
      })
      .then(ready)
  } else {
    let oldVersion = parseInt(oldStorage, 10)
    if (oldVersion < version) {
      status.set('updating')
      void Promise.resolve(clean(oldVersion)).then(async entries => {
        await init()
        for (let entry of entries ?? []) {
          let listener = actionListeners[entry[0].type]
          if (listener) await listener(entry[0], entry[1])
        }
        localStorage.setItem(key, String(version))
        ready()
      })
    } else if (oldVersion > version) {
      status.set('outdated')
      stop()
    } else {
      ready()
    }
  }

  if (typeof navigator !== 'undefined' && navigator.locks) {
    void navigator.locks.request(`${key}:lock`, () => {
      if (status.get() === 'outdated') return Promise.resolve()
      isLeader = true
      return new Promise(resolve => {
        releaseLock = resolve
      })
    })
  } else {
    isLeader = true
  }

  startStorageTracking(key, newValue => {
    if (parseInt(newValue, 10) > version) {
      status.set('outdated')
      stop()
      releaseLock()
    }
  })

  client.on('add', (action, meta) => {
    let listener = actionListeners[action.type]
    if (listener && isLeader) {
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

export function createStorageReducer(
  client,
  name,
  version,
  initialValue,
  callbacks
) {
  let encode = callbacks.encode ?? (v => v)
  let decode = callbacks.decode ?? (s => s)

  let value = atom(initialValue)

  let stored = localStorage.getItem(name)
  if (stored !== null) {
    value.set(decode(stored))
  }

  let reducer = createReducer(client, name, version, {
    clean() {
      value.set(initialValue)
      localStorage.removeItem(name)
      return callbacks.repeat()
    }
  })

  startStorageTracking(name, newValue => {
    value.set(decode(newValue))
  })

  return {
    status: reducer.status,
    type(type, listener) {
      reducer.type(type, async (action, meta) => {
        let newValue = await listener(value.get(), action, meta)
        value.set(newValue)
        localStorage.setItem(name, encode(newValue))
      })
    },
    value
  }
}
