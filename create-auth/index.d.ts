import { MapStore } from 'nanostores'

import { Client } from '../client/index.js'

/**
 * Auth store. Use {@link createAuth} to create it.
 */
export interface AuthStore
  extends MapStore<{
    userId: string
    isAuthenticated: boolean
  }> {
  /**
   * While store is loading initial state.
   */
  readonly loading: Promise<void>
}

/**
 * Create store with user’s authentication state.
 *
 * ```js
 * import { createAuth } from '@logux/client'
 * import { getValue } from 'nanostores'
 *
 * let auth = createAuth(client)
 * await auth.loading
 * console.log(getValue(auth))
 * ```
 *
 * @param client Logux Client.
 */
export function createAuth(client: Client): AuthStore
