import { Unsubscribe } from 'nanoevents'
import {
  Connection,
  LogStore,
  TestTime,
  Log,
  ClientNode,
  Action,
  Meta,
  TokenGenerator
} from '@logux/core'

type TabID = string

export interface ClientActionListener {
  (action: Action, meta: ClientMeta): void
}

export type ClientMeta = Meta & {
  /**
   * Action should be visible only for browser tab with the same `client.tabId`.
   */
  tab?: TabID

  /**
   * This action should be synchronized with other browser tabs and server.
   */
  sync?: boolean

  /**
   * Disable setting `timeTravel` reason.
   */
  noAutoReason?: boolean
}

export type ClientOptions = {
  /**
   * Server URL.
   */
  server: string | Connection

  /**
   * Client subprotocol version in SemVer format.
   */
  subprotocol: string

  /**
   * User ID.
   */
  userId: string

  /**
   * Client credentials for authentication.
   */
  token?: string | TokenGenerator

  /**
   * Prefix for `IndexedDB` database to run multiple Logux instances
   * in the same browser. Default is `logux`.
   */
  prefix?: string

  /**
   * Timeout in milliseconds to break connection. Default is `20000`.
   */
  timeout?: number

  /**
   * Milliseconds since last message to test connection by sending ping.
   * Default is `10000`.
   */
  ping?: number

  /**
   * Store to save log data. Default is `MemoryStore`.
   */
  store?: LogStore

  /**
   * Test time to test client.
   */
  time?: TestTime

  /**
   * Minimum delay between reconnections. Default is `1000`.
   */
  minDelay?: number

  /**
   * Maximum delay between reconnections. Default is `5000`.
   */
  maxDelay?: number

  /**
   * Maximum reconnection attempts. Default is `Infinity`.
   */
  attempts?: number

  /**
   * Do not show warning when using `ws://` in production.
   */
  allowDangerousProtocol?: boolean
}

/**
 * Base class for browser API to be extended in {@link CrossTabClient}.
 *
 * Because this class could have conflicts between different browser tab,
 * you should use it only if you are really sure, that application will not
 * be run in different tab (for instance, if you are developing a kiosk app).
 *
 * ```js
 * import { Client } from '@logux/client'
 *
 * const userId = document.querySelector('meta[name=user]').content
 * const token = document.querySelector('meta[name=token]').content
 *
 * const client = new Client({
 *   credentials: token,
 *   subprotocol: '1.0.0',
 *   server: 'wss://example.com:1337',
 *   userId: userId
 * })
 * client.start()
 * ```
 */
export class Client<H extends object = {}, L extends Log = Log<ClientMeta>> {
  /**
   * @param opts Client options.
   */
  constructor (opts: ClientOptions)

  /**
   * Client options.
   *
   * ```js
   * console.log('Connecting to ' + client.options.server)
   * ````
   */
  options: ClientOptions

  /**
   * Unique permanent client ID. Can be used to track this machine.
   */
  clientId: string

  /**
   * Unique tab ID. Can be used to add an action to the specific tab.
   *
   * ```js
   * client.log.add(action, { tab: client.tabId })
   * ```
   */
  tabId: TabID

  /**
   * Unique Logux node ID.
   *
   * ```js
   * console.log('Client ID: ', client.nodeId)
   * ```
   */
  nodeId: string

  /**
   * Client events log.
   *
   * ```js
   * client.log.add(action)
   * ```
   */
  log: L

  /**
   * Node instance to synchronize logs.
   *
   * ```js
   * if (client.node.state === 'synchronized')
   * ```
   */
  node: ClientNode<H, L>

  /**
   * Connect to server and reconnect on any connection problem.
   *
   * ```js
   * client.start()
   * ```
   */
  start (): void

  /**
   * Subscribe for synchronization events. It implements Nano Events API.
   * Supported events:
   *
   * * `preadd`: action is going to be added (in current tab).
   * * `add`: action has been added to log (by any tab).
   * * `clean`: action has been removed from log (by any tab).
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
  on (
    event: 'preadd' | 'add' | 'clean',
    listener: ClientActionListener
  ): Unsubscribe
  on (event: 'user', listener: (userId: string) => void): Unsubscribe

  /**
   * Disconnect from the server, update user, and connect again
   * with new credentials.
   *
   * ```js
   * onAuth(async (userId, token) => {
   *   showLoader()
   *   client.changeUser(userId, token)
   *   await client.node.waitFor('synchronized')
   *   hideLoader()
   * })
   * ```
   *
   * You need manually chang user ID in all browser tabs.
   *
   * @param userId The new user ID.
   * @param token Credentials for new user.
   */
  changeUser (userId: string, token?: string): void

  /**
   * Disconnect and stop synchronization.
   *
   * ```js
   * shutdown.addEventListener('click', () => {
   *   client.destroy()
   * })
   * ```
   */
  destroy (): void

  /**
   * Clear stored data. Removes action log from `IndexedDB` if you used it.
   *
   * ```js
   * signout.addEventListener('click', () => {
   *   client.clean()
   * })
   * ```
   *
   * @returns Promise when all data will be removed.
   */
  clean (): Promise<void>
}
