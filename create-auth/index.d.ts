import { Store } from '@logux/state'

import { Client } from '../client/index.js'

/**
 * Auth store. Use {@link createAuth} to create it.
 */
export type Auth = Store<{
  userId: string
  isAuthenticated: boolean
}>

/**
 * Create {@link Auth} store.
 *
 * It subscribes to changes in the user’s authentication state and id.
 *
 * ```js
 * import { createAuth } from '@logux/client'
 * import { getValue } from '@logux/state'
 *
 * let auth = createAuth(client)
 * let { isAuthenticated, userId } = getValue(auth)
 * ```
 *
 * @param client Logux Client.
 */
export function createAuth(client: Client): Auth
