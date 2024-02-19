let pool = new Uint8Array(128)
let poolOffset = pool.length

function getRandomBytes(size) {
  if (poolOffset + size > pool.length) {
    crypto.getRandomValues(pool)
    poolOffset = 0
  }
  let result = pool.slice(poolOffset, poolOffset + size)
  poolOffset += size
  return result
}

const SPACES = ' \t\n\r'

export function getRandomSpaces() {
  let size = getRandomBytes(1)[0] % 32
  let bytes = getRandomBytes(Math.ceil(size / 4))
  let result = ''
  for (let byte of bytes) {
    // Binary operations to use one random byte to get 4 random spaces
    result += SPACES[byte & 3]
    result += SPACES[(byte & 12) >> 2]
    result += SPACES[(byte & 48) >> 4]
    result += SPACES[(byte & 192) >> 6]
  }
  return result.slice(0, size)
}

function sha256(string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(string))
}

function bytesToObj(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes))
}

function objToBytes(object) {
  return new TextEncoder().encode(JSON.stringify(object) + getRandomSpaces())
}

function aes(iv) {
  return { iv, name: 'AES-GCM' }
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
  let iv = getRandomBytes(12)
  let encrypted = await crypto.subtle.encrypt(aes(iv), key, objToBytes(action))

  return {
    d: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    type: '0'
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

export async function encryptActions(client, secret, opts = {}) {
  let key
  if (secret instanceof CryptoKey) {
    key = secret
  } else {
    key = await getKey()
  }

  async function getKey() {
    let _key = crypto.subtle.importKey(
      'raw',
      await sha256(secret),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )

    return _key
  }

  let ignore = new Set(opts.ignore || [])

  async function onReceive(action, meta) {
    if (action.type === '0') {
      if (!key) key = await getKey()
      let decrypted = await decrypt(action, key)
      return [decrypted, meta]
    } else {
      return [action, meta]
    }
  }

  let originOnSend = client.node.options.onSend
  client.node.options.onSend = async (action, meta) => {
    let result = await originOnSend(action, meta)
    if (!result) {
      return false
    } else if (result[0].type === '0/clean' || ignore.has(result[0].type)) {
      return [result[0], result[1]]
    } else {
      if (!key) key = await getKey()
      let encrypted = await encrypt(result[0], key)
      return [encrypted, result[1]]
    }
  }

  client.node.options.onReceive = onReceive

  client.log.on('clean', (action, meta) => {
    if (meta.sync) {
      client.log.add({ id: meta.id, type: '0/clean' }, { sync: true })
    }
  })
}
