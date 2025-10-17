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
  if (typeof window !== 'undefined') {
    return window.btoa(binaryString)
  } else {
    /* c8 ignore next 2 */
    return Buffer.from(binaryString, 'binary').toString('base64')
  }
}

function base64ToBytes(string) {
  let binaryString
  if (typeof window !== 'undefined') {
    binaryString = window.atob(string)
  } else {
    /* c8 ignore next 2 */
    binaryString = Buffer.from(string, 'base64').toString('binary')
  }
  let length = binaryString.length
  let bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

async function compress(bytes) {
  let cs = new CompressionStream('deflate-raw')
  let writer = cs.writable.getWriter()
  writer.write(bytes)
  writer.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

async function decompress(bytes) {
  let ds = new DecompressionStream('deflate-raw')
  let writer = ds.writable.getWriter()
  writer.write(new Uint8Array(bytes))
  writer.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

async function encrypt(action, key) {
  let iv = getRandomBytes(12)
  let bytes = objToBytes(action)
  let z = bytes.length > 100
  if (z) bytes = await compress(bytes)
  let encrypted = await crypto.subtle.encrypt(aes(iv), key, bytes)

  return {
    d: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    type: '0',
    z
  }
}

async function decrypt(action, key) {
  let bytes = await crypto.subtle.decrypt(
    aes(base64ToBytes(action.iv)),
    key,
    base64ToBytes(action.d)
  )
  if (action.z) bytes = await decompress(bytes)
  return bytesToObj(bytes)
}

export function encryptActions(client, secret, opts = {}) {
  let key
  if (typeof CryptoKey !== 'undefined' && secret instanceof CryptoKey) {
    key = secret
  }

  async function buildKey() {
    return crypto.subtle.importKey(
      'raw',
      await sha256(secret),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )
  }

  let ignore = new Set(opts.ignore || [])

  async function onReceive(action, meta) {
    if (action.type === '0') {
      if (!key) key = await buildKey()
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
      if (!key) key = await buildKey()
      let encrypted = await encrypt(result[0], key)
      return [encrypted, result[1]]
    }
  }

  client.node.options.onReceive = onReceive

  client.log.on('clean', (action, meta) => {
    if (meta.sync && !ignore.has(action.type)) {
      client.log.add({ id: meta.id, type: '0/clean' }, { sync: true })
    }
  })
}
