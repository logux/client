let errorOnSet

export function setLocalStorage() {
  errorOnSet = undefined
  window.localStorage = {
    clear() {
      this.storage = {}
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
    },
    setItem(key, value) {
      if (errorOnSet) throw errorOnSet
      this[key] = value
      this.storage[key] = String(value)
    },
    storage: {}
  }
}

export function breakLocalStorage(error) {
  errorOnSet = error
}

export function emitStorage(key, newValue) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}
