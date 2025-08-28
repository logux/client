import type { Action, Log } from '@logux/core'
import type { Unsubscribe } from 'nanoevents'

import { Client } from '../client/index.js'
import type { ClientActionListener, ClientMeta } from '../client/index.js'

/**
 * Low-level browser API for Logux.
 *
 * Instead of {@link Client}, this class prevents conflicts
 * between Logux instances in different tabs on single browser.
 *
 * ```js
 * import { CrossTabClient } from '@logux/client'
 *
 * const userId = document.querySelector('meta[name=user]').content
 * const token = document.querySelector('meta[name=token]').content
 *
 * const client = new CrossTabClient({
 *   subprotocol: 1,
 *   server: 'wss://example.com:1337',
 *   userId,
 *   token
 * })
 * client.start()
 * ```
 */
export class CrossTabClient<
  Headers extends object = object,
  ClientLog extends Log = Log<ClientMeta>
> extends Client<Headers, ClientLog> {
  /**
   * Cache for localStorage detection. Can be overridden to disable leader tab
   * election in tests.
   */
  isLocalStorage: boolean

  /**
   * Current tab role. Only `leader` tab connects to server. `followers` just
   * listen to events from `leader`.
   *
   * ```js
   * client.on('role', () => {
   *   console.log('Tab role:', client.role)
   * })
   * ```
   */
  role: 'follower' | 'leader'

  on(
    event: 'add' | 'clean' | 'preadd',
    listener: ClientActionListener<Action>
  ): Unsubscribe
  /**
   * Subscribe for synchronization events. It implements nanoevents API.
   * Supported events:
   *
   * * `preadd`: action is going to be added (in current tab).
   * * `add`: action has been added to log (by any tab).
   * * `clean`: action has been removed from log (by any tab).
   * * `role`: tab role has been changed.
   * * `state`: leader tab synchronization state has been changed.
   * * `user`: user ID was changed.
   *
   * ```js
   * client.on('add', (action, meta) => {
   *   dispatch(action)
   * })
   * ```
   *
   * @param event The event name.
   * @param listener The listener function.
   * @returns Unbind listener from event.
   */
  on(event: 'role' | 'state', listener: () => void): Unsubscribe
  on(event: 'user', listener: (userId: string) => void): Unsubscribe
}
