function sha256(string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(string))
}

function bytesToObj(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes))
}

function objToBytes(object) {
  return new TextEncoder().encode(JSON.stringify(object))
}

function aes(iv) {
  return { name: 'AES-GCM', iv }
}

function bytesToBase64(bytes) {
  let binaryString = String.fromCharCode.apply(null, bytes)
  return window.btoa(binaryString)
}

function base64ToBytes(string) {
  let binaryString = window.atob(string)
  let length = binaryString.length
  let bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

async function encrypt(action, key) {
  let iv = crypto.getRandomValues(new Uint8Array(12))
  let crypted = await crypto.subtle.encrypt(aes(iv), key, objToBytes(action))
  return {
    type: '0',
    d: bytesToBase64(new Uint8Array(crypted)),
    iv: bytesToBase64(iv)
  }
}

async function decrypt(action, key) {
  let bytes = await crypto.subtle.decrypt(
    aes(base64ToBytes(action.iv)),
    key,
    base64ToBytes(action.d)
  )
  return bytesToObj(bytes)
}

export function encryptActions(client, secret, opts = {}) {
  let key
  async function getKey() {
    key = await crypto.subtle.importKey(
      'raw',
      await sha256(secret),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )
    return key
  }

  let ignore = new Set(opts.ignore || [])
  async function outMap(action, meta) {
    if (action.type === '0/clean' || ignore.has(action.type)) {
      return [action, meta]
    } else {
      if (!key) key = await getKey()
      let encrypted = await encrypt(action, key)
      return [encrypted, meta]
    }
  }

  async function inMap(action, meta) {
    if (action.type === '0') {
      if (!key) key = await getKey()
      let decrypted = await decrypt(action, key)
      return [decrypted, meta]
    } else {
      return [action, meta]
    }
  }

  let originOutMap = client.node.options.outMap
  client.node.options.outMap = async (action, meta) => {
    let converted = await originOutMap(action, meta)
    return outMap(...converted)
  }

  client.node.options.inMap = inMap

  client.log.on('clean', (action, meta) => {
    if (meta.sync) {
      client.log.add({ type: '0/clean', id: meta.id }, { sync: true })
    }
  })
}
