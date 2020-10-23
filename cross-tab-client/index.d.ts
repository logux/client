import { Action, Log } from '@logux/core'
import { Unsubscribe } from 'nanoevents'

import { Client, ClientActionListener, ClientMeta } from '../client/index.js'

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
 *   subprotocol: '1.0.0',
 *   server: 'wss://example.com:1337',
 *   userId,
 *   token
 * })
 * client.start()
 * ```
 */
export class CrossTabClient<
  H extends object = {},
  L extends Log = Log<ClientMeta>
> extends Client<H, L> {
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
  role: 'leader' | 'candidate' | 'follower'

  /**
   * Leader tab synchronization state. It can differs
   * from `client.node.state` (because only the leader tab keeps connection).
   *
   * ```js
   * client.on('state', () => {
   *   if (client.state === 'disconnected' && client.state === 'sending') {
   *     showCloseWarning()
   *   }
   * })
   * ```
   */
  state: 'disconnected' | 'connecting' | 'sending' | 'synchronized'

  /**
   * Is leader tab connected to server.
   */
  connected: boolean

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
  on (event: 'role' | 'state', listener: () => void): Unsubscribe
  on (event: 'user', listener: (userId: string) => void): Unsubscribe
  on (
    event: 'preadd' | 'add' | 'clean',
    listener: ClientActionListener<Action>
  ): Unsubscribe

  /**
   * Wait for specific state of the leader tab.
   *
   * ```js
   * await client.waitFor('synchronized')
   * hideLoader()
   * ```
   *
   * @param state State name
   */
  waitFor (
    state: 'disconnected' | 'connecting' | 'sending' | 'synchronized'
  ): Promise<void>
}
