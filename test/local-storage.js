let errorOnSet

export function setLocalStorage() {
  errorOnSet = undefined
  window.localStorage = {
    storage: {},
    setItem(key, value) {
      if (errorOnSet) throw errorOnSet
      this[key] = value
      this.storage[key] = String(value)
    },
    getItem(key) {
      if (key in this.storage) {
        return this.storage[key]
      } else {
        return null
      }
    },
    removeItem(key) {
      delete this[key]
      delete this.storage[key]
    }
  }
}

export function breakLocalStorage(error) {
  errorOnSet = error
}

export function emitStorage(key, newValue) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}
