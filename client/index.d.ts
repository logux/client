import {
  Connection, Store, TestTime, Log, ClientNode, Action, Meta, ID
} from '@logux/core'

type TabID = string

export interface clientActionListener {
  (action: Action, meta: ClientMeta): void
}

interface clientActionIterator {
  (action: Action, meta: ClientMeta): boolean | void
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

type GetOptions = {
  order?: 'created' | 'added'
}

export class ClientLog extends Log {
  add (action: Action, meta?: Partial<ClientMeta>): Promise<ClientMeta|false>

  on (
    event: 'preadd' | 'add' | 'clean', listener: clientActionListener
  ): () => void

  changeMeta (id: ID, diff: Partial<ClientMeta>): Promise<boolean>

  each (opts: GetOptions, callback: clientActionIterator): Promise<void>

  byId (id: ID): Promise<[Action, ClientMeta]|[null, null]>
}

type ClientOptions = {
  /**
   * Server URL.
   */
  server: string | Connection

  /**
   * Client subprotocol version in SemVer format.
   */
  subprotocol: string

  /**
   * User ID. Pass `false` if no user.
   */
  userId: string | false

  /**
   * Client credentials for authentication.
   */
  credentials?: string

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
  store?: Store

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
 * const app = new Client({
 *   credentials: token,
 *   subprotocol: '1.0.0',
 *   server: 'wss://example.com:1337',
 *   userId: userId
 * })
 * app.start()
 * ```
 */
export class Client {
  /**
   * @param opts Client options.
   */
  constructor (opts: ClientOptions)

  /**
   * Client options.
   *
   * ```js
   * console.log('Connecting to ' + app.options.server)
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
   * app.log.add(action, { tab: app.tabId })
   * ```
   */
  tabId: TabID

  /**
   * Unique Logux node ID.
   *
   * ```js
   * console.log('Client ID: ', app.nodeId)
   * ```
   */
  nodeId: string

  /**
   * Client events log.
   *
   * ```js
   * app.log.add(action)
   * ```
   */
  log: ClientLog

  /**
   * Node instance to synchronize logs.
   *
   * ```js
   * if (client.node.state === 'synchronized')
   * ```
   */
  node: ClientNode

  /**
   * Connect to server and reconnect on any connection problem.
   *
   * ```js
   * app.start()
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
    event: 'preadd' | 'add' | 'clean', listener: clientActionListener
  ): () => void

  /**
   * Disconnect and stop synchronization.
   *
   * ```js
   * shutdown.addEventListener('click', () => {
   *   app.destroy()
   * })
   * ```
   */
  destroy (): void

  /**
   * Clear stored data. Removes action log from `IndexedDB` if you used it.
   *
   * ```js
   * signout.addEventListener('click', () => {
   *   app.clean()
   * })
   * ```
   *
   * @returns Promise when all data will be removed.
   */
  clean (): Promise<void>
}
