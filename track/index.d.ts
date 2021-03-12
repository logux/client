import { Log, ID } from '@logux/core'

import { Client } from '../client/index.js'

/**
 * Track for `logux/processed` or `logux/undo` answer from server
 * for the cases when `Client#sync` can’t be used.
 *
 * ```js
 * client.type('pay', (action, meta) => {
 *   track(client, id).then(() => {
 *     console.log('paid')
 *   }).catch(() => {
 *     console.log('unpaid')
 *   })
 * })
 * ```
 *
 * @param client Logux Client.
 * @param id Action ID.
 * @returns Promise when action was proccessed.
 */
export function track(client: Log | Client, id: ID): Promise<void>
