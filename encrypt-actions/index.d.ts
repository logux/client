import type { Client } from '../client/index.js'

/**
 * Encrypt actions before sending them to server.
 *
 * Actions will be converted to `{ type: '0', d: encrypt(action) }`.
 * `logux/*` actions (like `logux/subscribe`) are never encrypted,
 * because server needs to read them.
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
 * The secret can be a promise or a function, if user will enter
 * the password later. Actions will wait for it on sending and receiving.
 *
 * ```js
 * encryptActions(client, () => passwordEntered)
 * ```
 *
 * @param client Observed Client instance.
 * @param secret Password for encryption, or a CryptoKey AES key,
 *               or a promise or a function returning them.
 * @param opts Encryption options.
 */
export function encryptActions(
  client: Pick<Client, 'log' | 'node'>,
  secret:
    | (() => CryptoKey | Promise<CryptoKey | string> | string)
    | CryptoKey
    | Promise<CryptoKey | string>
    | string,
  opts?: {
    /**
     * Do not send `0/clean` action automatically on action cleaning.
     */
    clean?: boolean
    /**
     * List of `action.type` or action creators to not be encrypted.
     */
    ignore?: (string | { type: string })[]
  }
): void

export function getRandomSpaces(): string
