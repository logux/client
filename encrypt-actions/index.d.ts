import { Action, Meta } from '@logux/core'

import { Client } from '../client/index.js'

export type ZeroAction = Action & {
  type: '0'
  d: string
  iv: string
}

export type ZeroCleanAction = Action & {
  type: '0/clean'
  id: Meta['id']
}

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
 * @param secret Password for encryption.
 * @param opts Encryption options.
 * @returns Unbind listener.
 */
export function encryptActions (
  client: Client,
  secret: string,
  opts?: {
    ignore: string[]
  }
): () => void
