import { atom } from 'nanostores'

let storageTracking = false
let storageListeners = {}

function defaultStorage() {
  // Without localStorage (SSR, React Native) the version is kept in memory
  return typeof localStorage === 'undefined' ? {} : localStorage
}

// Only localStorage sends `storage` events to sync other tabs
function hasStorageEvents(storage) {
  return typeof window !== 'undefined' && storage === window.localStorage
}

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

function stopStorageTracking(key) {
  delete storageListeners[key]
}

export function createReducer(client, name, version, callbacks) {
  let clean = callbacks.clean ?? (() => {})
  let init = callbacks.init ?? (() => {})
  let stop = callbacks.stop ?? (() => {})
  let storage = callbacks.storage ?? defaultStorage()

  let status = atom('initializing')

  let setReady
  let ready = new Promise(resolve => {
    setReady = resolve
  })

  let actionsWaiting = []
  let actionListeners = {}

  let destroyed = false
  let isLeader = false
  let lockRequest = new AbortController()
  let releaseLock = () => {}

  let promise = Promise.resolve()
  function becomeReady() {
    if (destroyed) return
    for (let entry of actionsWaiting) {
      let listener = actionListeners[entry[0].type]
      if (listener) {
        promise = promise.then(() => listener(entry[0], entry[1]))
      }
    }
    actionsWaiting = []
    status.set('ready')
    setReady()
  }

  let key = `logux:reducer:${name}`
  let oldStorage = storage[key]
  if (!oldStorage) {
    let initializing = init() ?? Promise.resolve()
    initializing
      .then(() => {
        storage[key] = String(version)
      })
      .then(becomeReady)
  } else {
    let oldVersion = parseInt(oldStorage, 10)
    if (oldVersion < version) {
      status.set('migrating')
      if (callbacks.migrating) callbacks.migrating(ready)
      void Promise.resolve(clean(oldVersion)).then(async entries => {
        if (destroyed) return
        await init()
        for (let entry of entries ?? []) {
          if (destroyed) return
          let listener = actionListeners[entry[0].type]
          if (listener) await listener(entry[0], entry[1])
        }
        storage[key] = String(version)
        becomeReady()
      })
    } else if (oldVersion > version) {
      status.set('outdated')
      stop()
      setReady()
    } else {
      becomeReady()
    }
  }

  if (typeof navigator !== 'undefined' && navigator.locks) {
    navigator.locks
      .request(`${key}:lock`, { signal: lockRequest.signal }, () => {
        if (destroyed || status.get() === 'outdated') return Promise.resolve()
        isLeader = true
        return new Promise(resolve => {
          releaseLock = resolve
        })
      })
      .catch(() => {})
  } else {
    isLeader = true
  }

  if (hasStorageEvents(storage)) {
    startStorageTracking(key, newValue => {
      if (parseInt(newValue, 10) > version) {
        status.set('outdated')
        stop()
        releaseLock()
        setReady()
      }
    })
  }

  let unbindAdd = client.on('add', (action, meta) => {
    let listener = actionListeners[action.type]
    if (listener && isLeader) {
      if (status.get() !== 'ready') {
        actionsWaiting.push([action, meta])
      } else {
        promise = promise.then(() => listener(action, meta))
      }
    }
  })

  let unbindCleaning = client.on('cleaning', () => {
    delete storage[key]
  })

  let reducer = {
    destroy() {
      if (destroyed) return
      destroyed = true
      unbindAdd()
      unbindCleaning()
      stopStorageTracking(key)
      lockRequest.abort()
      releaseLock()
      actionsWaiting = []
      setReady()
    },
    ready,
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
  let storage = callbacks.storage ?? defaultStorage()

  let value = atom(initialValue)

  let stored = storage[name]
  if (typeof stored === 'string') {
    value.set(decode(stored))
  }

  let reducer = createReducer(client, name, version, {
    clean() {
      value.set(initialValue)
      delete storage[name]
      return callbacks.repeat()
    },
    migrating: callbacks.migrating,
    storage
  })

  let unbindCleaning = client.on('cleaning', () => {
    value.set(initialValue)
    delete storage[name]
  })

  if (hasStorageEvents(storage)) {
    startStorageTracking(name, newValue => {
      value.set(decode(newValue))
    })
  }

  return {
    destroy() {
      unbindCleaning()
      stopStorageTracking(name)
      reducer.destroy()
    },
    ready: reducer.ready,
    status: reducer.status,
    type(type, listener) {
      reducer.type(type, async (action, meta) => {
        let prevValue = value.get()
        let newValue = await listener(prevValue, action, meta)
        if (!value.eq(prevValue, newValue)) {
          value.set(newValue)
          storage[name] = encode(newValue)
        }
      })
    },
    value
  }
}
