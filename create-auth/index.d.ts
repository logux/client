import { MapStore } from '@logux/state'

import { Client } from '../client/index.js'

/**
 * Auth store. Use {@link createAuth} to create it.
 */
export type Auth = MapStore<{
  userId: string
  isAuthenticated: boolean
}>

/**
 * Create store with user’s authentication state.
 *
 * ```js
 * import { createAuth } from '@logux/client'
 * import { getValue } from '@logux/state'
 *
 * let auth = createAuth(client)
 * auth.subscribe(({ isAuthenticated, userId }) => {
 *   console.log(isAuthenticated, userId)
 * })
 * ```
 *
 * @param client Logux Client.
 */
export function createAuth(client: Client): Auth
