import type { Client } from '../client/index.js'

/**
 * Encrypt actions before sending them to server.
 *
 * Actions will be converted to `{ type: '0', d: encrypt(action) }`
 *
 * Client will be switched to binary protocol, which has a compact format
 * for encrypted actions. Call it before `client.start()`.
 *
 * ```js
 * import { encryptActions } from '@logux/client'
 * encryptActions(client, localStorage.getItem('userPassword'), {
 *   ignore: ['server/public'] // action.type to not be encrypted
 * })
 * ```
 *
 * @param client Observed Client instance.
 * @param secret Password for encryption, or a CryptoKey AES key.
 * @param opts Encryption options.
 * @returns Unbind listener.
 */
export function encryptActions(
  client: Client,
  secret: CryptoKey | string,
  opts?: {
    /**
     * Do not send `0/clean` action automatically on action cleaning.
     */
    clean?: boolean
    /**
     * List of `action.type` to not be encrypted.
     */
    ignore?: string[]
  }
): void

export function getRandomSpaces(): string
