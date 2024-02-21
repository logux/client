import type { Client } from '../client/index.js'

/**
 * Encrypt actions before sending them to server.
 *
 * Actions will be converted to `{ type: '0', d: encrypt(action) }`
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
 * @param opts Encryption options -- can pass in strings
 * to *not* encrypt.
 * @returns Unbind listener.
 */
export async function encryptActions(
  client: Client,
  secret: CryptoKey|string,
  opts?: {
    ignore: string[]
  }
):Promise<void>

export function getRandomSpaces(): string
