import { WsBinaryConnection, WsConnection } from '@logux/core'

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

async function compress(bytes) {
  let cs = new CompressionStream('deflate-raw')
  let writer = cs.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

async function decompress(bytes) {
  let ds = new DecompressionStream('deflate-raw')
  let writer = ds.writable.getWriter()
  void writer.write(new Uint8Array(bytes))
  void writer.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

async function encrypt(action, key) {
  let iv = getRandomBytes(12)
  let bytes = objToBytes(action)
  let compressed = bytes.length > 100
  if (compressed) bytes = await compress(bytes)
  let encrypted = await crypto.subtle.encrypt(aes(iv), key, bytes)

  return {
    compressed,
    d: new Uint8Array(encrypted),
    iv: iv,
    type: '0'
  }
}

// Bytes inside JSON (like `logux/undo` with encrypted `action`)
// are converted to `{ "0": byte, "1": byte }`
function toBytes(value) {
  return value instanceof Uint8Array
    ? value
    : new Uint8Array(Object.values(value))
}

async function decrypt(action, key) {
  let bytes = await crypto.subtle.decrypt(
    aes(toBytes(action.iv)),
    key,
    toBytes(action.d)
  )
  if (action.compressed) bytes = await decompress(bytes)
  return bytesToObj(bytes)
}

export function encryptActions(client, secret, opts = {}) {
  let key
  // Secret can be loaded later, so it is resolved only on the first action
  function getKey() {
    key ??= Promise.resolve(typeof secret === 'function' ? secret() : secret)
      .then(async value => {
        if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) {
          return value
        }
        return crypto.subtle.importKey(
          'raw',
          await sha256(value),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        )
      })
      .catch(error => {
        key = undefined
        throw error
      })
    return key
  }

  // Binary protocol has a dedicated compact format for encrypted actions,
  // so it sends `d` and `iv` bytes without Base64 overhead
  let reconnect = client.node.connection
  let text = reconnect.connection
  if (text instanceof WsConnection) {
    let binary = new WsBinaryConnection(text.url, text.Class, text.opts)
    // Node and Reconnect already subscribed to the events of old connection
    binary.emitter = text.emitter
    reconnect.connection = binary
  }

  // Client can not send or read anything without the key,
  // so it does not connect until the key will be loaded
  if (typeof secret === 'function' || typeof secret.then === 'function') {
    let connection = client.node.connection
    let originConnect = connection.connect.bind(connection)
    connection.connect = async () => {
      try {
        await getKey()
      } catch (e) {
        client.node.emitter.emit('error', e)
        return
      }
      return originConnect()
    }
  }

  let ignore = new Set(
    (opts.ignore || []).map(i => (typeof i === 'string' ? i : i.type))
  )

  // Server must read `logux/*` actions to process subscriptions
  function isSkipped(type) {
    return type === '0/clean' || type.startsWith('logux/') || ignore.has(type)
  }

  // Client converts old actions by `onReceive`, which must get
  // the decrypted action
  let originOnReceive = client.node.options.onReceive
  async function onReceive(action, meta) {
    if (action.type === '0') {
      action = await decrypt(action, await getKey())
    } else if (action.type === 'logux/undo' && action.action?.type === '0') {
      action = {
        ...action,
        action: await decrypt(action.action, await getKey())
      }
    }
    return originOnReceive ? originOnReceive(action, meta) : [action, meta]
  }

  let originOnSend = client.node.options.onSend
  client.node.options.onSend = async (action, meta) => {
    let result = await originOnSend(action, meta)
    if (!result) {
      return false
    } else if (isSkipped(result[0].type)) {
      return [result[0], result[1]]
    } else {
      let encrypted = await encrypt(result[0], await getKey())
      return [encrypted, result[1]]
    }
  }

  client.node.options.onReceive = onReceive

  if (opts.clean !== false) {
    // Log cleaning removes many actions at once, so they are cleaned
    // on the server by a single action. Microtask keeps it before the end
    // of the cleaning call, so the client can be destroyed right after it.
    let cleaning = []
    client.log.on('clean', (action, meta) => {
      if (meta.sync && !isSkipped(action.type)) {
        if (cleaning.length === 0) {
          queueMicrotask(() => {
            let ids = cleaning
            cleaning = []
            client.log.add(
              ids.length === 1
                ? { id: ids[0], type: '0/clean' }
                : { ids, type: '0/clean' },
              { sync: true }
            )
          })
        }
        cleaning.push(meta.id)
      }
    })
  }
}
