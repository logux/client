import { Unsubscribe } from 'nanoevents'
import {
  Connection,
  LogStore,
  TestTime,
  Log,
  ClientNode,
  Action,
  Meta,
  TokenGenerator,
  AnyAction
} from '@logux/core'

type TabID = string

export interface ClientActionListener<ListenAction extends Action> {
  (action: ListenAction, meta: ClientMeta): void
}

export interface ClientMeta extends Meta {
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

export interface ClientOptions {
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
export class Client<
  Headers extends object = {},
  ClientLog extends Log = Log<ClientMeta>
> {
  /**
   * @param opts Client options.
   */
  constructor(opts: ClientOptions)

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
  log: ClientLog

  /**
   * Node instance to synchronize logs.
   *
   * ```js
   * if (client.node.state === 'synchronized')
   * ```
   */
  node: ClientNode<Headers, ClientLog>

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
  state: ClientNode['state']

  /**
   * Is leader tab connected to server.
   */
  connected: boolean

  /**
   * Connect to server and reconnect on any connection problem.
   *
   * ```js
   * client.start()
   * ```
   */
  start(): void

  /**
   * Send action to the server (by setting `meta.sync` and adding to the log)
   * and track server processing.
   *
   * ```js
   * showLoader()
   * client.sync(
   *   { type: 'CHANGE_NAME', name }
   * ).then(() => {
   *   hideLoader()
   * }).catch(error => {
   *   hideLoader()
   *   showError(error.action.reason)
   * })
   * ```
   *
   * @param action The action
   * @param meta Optional meta.
   * @returns Promise for server processing.
   */
  sync(action: AnyAction, meta?: Partial<ClientMeta>): Promise<ClientMeta>

  /**
   * Add listener for adding action with specific type.
   * Works faster than `on('add', cb)` with `if`.
   *
   * ```js
   * client.type('rename', (action, meta) => {
   *   name = action.name
   * })
   * ```
   *
   * @param type Action’s type.
   * @param ActionListener The listener function.
   * @param event
   * @returns Unbind listener from event.
   */
  type<TypeAction extends Action = Action>(
    type: TypeAction['type'],
    listener: ClientActionListener<TypeAction>,
    opts?: { id?: string; event?: 'preadd' | 'add' | 'clean' }
  ): Unsubscribe

  /**
   * Subscribe for synchronization events. It implements Nano Events API.
   * Supported events:
   *
   * * `preadd`: action is going to be added (in current tab).
   * * `add`: action has been added to log (by any tab).
   * * `clean`: action has been removed from log (by any tab).
   * * `user`: user ID was changed.
   *
   * Note, that `Log#type()` will work faster than `on` event with `if`.
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
  on(event: 'state', listener: () => void): Unsubscribe
  on(
    event: 'preadd' | 'add' | 'clean',
    listener: ClientActionListener<Action>
  ): Unsubscribe
  on(event: 'user', listener: (userId: string) => void): Unsubscribe

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
  changeUser(userId: string, token?: string): void

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
  waitFor(state: ClientNode['state']): Promise<void>

  /**
   * Disconnect and stop synchronization.
   *
   * ```js
   * shutdown.addEventListener('click', () => {
   *   client.destroy()
   * })
   * ```
   */
  destroy(): void

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
  clean(): Promise<void>
}
