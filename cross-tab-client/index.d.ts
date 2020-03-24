import { Unsubscribe } from 'nanoevents'

import { Client, ClientActionListener } from '../client'

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
 *   credentials: token.content,
 *   subprotocol: '1.0.0',
 *   server: 'wss://example.com:1337',
 *   userId: userId
 * })
 * client.start()
 * ```
 */
export class CrossTabClient extends Client {

  /**
   * Current tab role. Only `leader` tab connects to server. `followers` just
   * listen to events from `leader`.
   *
   * ```js
   * app.on('role', () => {
   *   console.log('Tab role:', app.role)
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
   *
   * ```js
   * app.on('add', (action, meta) => {
   *   dispatch(action)
   * })
   * ```
   *
   * @param event The event name.
   * @param listener The listener function.
   * @returns Unbind listener from event.
   */
  on (
    event: 'role' | 'state', listener: () => void
  ): Unsubscribe
  on (
    event: 'preadd' | 'add' | 'clean', listener: ClientActionListener
  ): Unsubscribe
}
