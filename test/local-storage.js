let errorOnSet = new Error()

// Like the real `Storage`: values are own enumerable keys of the object
// and the methods are hidden from `for … in`
let methods = {
  clear() {
    for (let key in this) delete this[key]
  },
  getItem(key) {
    let value = this[key]
    return typeof value === 'string' ? value : null
  },
  removeItem(key) {
    delete this[key]
  },
  setItem(key, value) {
    if (errorOnSet) throw errorOnSet
    this[key] = String(value)
  }
}

export function setLocalStorage() {
  errorOnSet = undefined
  let storage = {}
  for (let name in methods) {
    Object.defineProperty(storage, name, {
      value: methods[name],
      writable: true
    })
  }
  window.localStorage = storage
}

export function breakLocalStorage(error) {
  errorOnSet = error
}

export function emitStorage(key, newValue) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}
