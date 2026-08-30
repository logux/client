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
  let hasValue = callbacks.hasValue ?? (() => true)
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
  // `undefined` until the leader lock will be granted or taken by another tab
  let isLeader
  let lockRequest = new AbortController()
  let releaseLock = () => {}

  // The value is not built yet, so the version must not be saved
  let building = true

  let key = `logux:reducer:${name}`

  function saveVersion() {
    // The value, which was never built, or which was built only in half by
    // the interrupted replay, must not be marked as an up-to-date one
    if (destroyed || building || !hasValue()) return
    if (storage[key] !== String(version)) storage[key] = String(version)
  }

  let promise = Promise.resolve()

  function reduce(listener, action, meta) {
    promise = promise.then(() => listener(action, meta)).then(saveVersion)
  }

  function reduceWaiting() {
    if (!isLeader || status.get() !== 'ready') return
    for (let entry of actionsWaiting) {
      let listener = actionListeners[entry[0].type]
      if (listener) reduce(listener, entry[0], entry[1])
    }
    actionsWaiting = []
  }

  function becomeReady() {
    if (destroyed) return
    building = false
    status.set('ready')
    reduceWaiting()
    setReady()
  }

  let stored = storage[key]
  let oldVersion = typeof stored === 'string' ? parseInt(stored, 10) : undefined
  // The version is saved with the value, so the version alone means
  // the partially cleaned storage. Rebuilding is the safe answer
  if (!hasValue() && !(oldVersion > version)) oldVersion = undefined

  if (oldVersion > version) {
    status.set('outdated')
    stop()
    setReady()
  } else if (oldVersion === version) {
    becomeReady()
  } else {
    // The log can be filled before the reducer was created, so the value
    // is built by the repeated actions even on the first run
    if (typeof oldVersion !== 'undefined') {
      status.set('migrating')
      if (callbacks.migrating) callbacks.migrating(ready)
    }
    void Promise.resolve(clean(oldVersion ?? 0))
      .then(async entries => {
        if (destroyed) return
        await init()
        for (let entry of entries ?? []) {
          if (destroyed) return
          let listener = actionListeners[entry[0].type]
          if (listener) await listener(entry[0], entry[1])
        }
        becomeReady()
        saveVersion()
      })
      .catch(() => {
        // The database of the actions can be closed in the middle of the
        // rebuild. The version was not saved, so the next start will
        // build the value again
        becomeReady()
      })
  }

  function keepLock() {
    if (destroyed || status.get() === 'outdated') return Promise.resolve()
    isLeader = true
    reduceWaiting()
    return new Promise(resolve => {
      releaseLock = resolve
    })
  }

  if (typeof navigator !== 'undefined' && navigator.locks) {
    // The lock is granted in the next tick, and actions can come before it,
    // so `ifAvailable` tells right away whether another tab is the leader
    // and is reducing the same actions to not reduce them twice
    navigator.locks
      .request(`${key}:lock`, { ifAvailable: true }, lock => {
        if (lock) return keepLock()
        isLeader = false
        actionsWaiting = []
        // The lock will be granted when the leader’s tab will be closed
        return navigator.locks.request(
          `${key}:lock`,
          { signal: lockRequest.signal },
          keepLock
        )
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
    // Another tab is the leader and will put its value to the storage
    if (!listener || isLeader === false) return
    if (isLeader && status.get() === 'ready') {
      reduce(listener, action, meta)
    } else {
      actionsWaiting.push([action, meta])
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
    hasValue: () => typeof storage[name] === 'string',
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
