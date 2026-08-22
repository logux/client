import type { Action, MetaTime } from '@logux/core'
import type { ReadableAtom } from 'nanostores'

import type {
  AbstractActionCreator,
  ClientActionListener,
  ClientMeta,
  Client
} from '../client/index.js'

interface ActionListener<ListenAction extends Action> {
  (action: ListenAction, meta: ClientMeta | MetaTime): void | Promise<void>
}

export type PersistentStorage = Record<string, string | undefined>

interface ReducerInitCallbacks {
  init?(): void | Promise<void>

  /**
   * Called when the stored data has an older version. Clean the data here
   * and return the actions to reduce it again.
   */
  clean(
    oldVersion: number
  ): void | Promise<void> | [Action, MetaTime][] | Promise<[Action, MetaTime][]>

  /**
   * Called when the stored data has an older version and is being cleaned
   * and reduced again. A good place to show a “migrating data” loader
   * until the passed promise is resolved.
   *
   * @param done Promise resolved when the reducer is ready
   *             (the same as {@link Reducer#ready}).
   */
  migrating?(done: Promise<void>): void

  /**
   * Storage to keep the reducer’s version instead of `localStorage`
   * (for instance, for React Native or tests).
   *
   * Cross-tab `storage` events are used only if the storage
   * is `localStorage` itself.
   *
   * ```js
   * createReducer(client, 'db', 1, {
   *   storage: memoryStorage,
   *   clean() { … }
   * })
   * ```
   */
  storage?: PersistentStorage
  stop?(): void
}

type ReducerMigrationStatus =
  | 'initializing'
  | 'migrating'
  | 'outdated'
  | 'ready'

interface Reducer {
  /**
   * Stop the reducer: unsubscribe from the client, release the leader lock
   * and stop tracking `storage` events. Call it before creating a reducer
   * with the same name for another client, otherwise the new reducer will
   * wait for the lock forever and will never reduce anything.
   */
  destroy(): void

  /**
   * Promise resolved when the data was prepared and all actions
   * from the log were reduced.
   *
   * It is also resolved when the reducer became `outdated`, so awaiting it
   * will never hang. Check {@link Reducer#status} if you need to know
   * which of them happened.
   *
   * ```js
   * showLoader('Loading data', reducer.ready)
   * ```
   */
  readonly ready: Promise<void>

  status: ReadableAtom<ReducerMigrationStatus>

  type<TypeAction extends Action = Action>(
    type: TypeAction['type'],
    listener: ActionListener<TypeAction>
  ): void
  type<Creator extends AbstractActionCreator>(
    actionCreator: Creator,
    listener: ActionListener<ReturnType<Creator>>
  ): void
}

/**
 * Create long-term persistent Logux actions reducer. It can be used to store
 * Logux data in WASM sqlite or localStorage.
 *
 * Only one browser tab will reduce the log.
 *
 * The reducer’s version is removed on {@link Client#clean}, since the value
 * is not re-created from the log on the next start. Reducers with their own
 * storage should subscribe to the `cleaning` event to remove the data itself.
 *
 * ```ts
 * import { createReducer } from '@logux/client'
 *
 * let db = sqlite.openDatabase('database.sqlite')
 * createReducer(client, 'db', 10, {
 *   async clean() {
 *     await db.close()
 *     await sqlite.removeFile('database.sqlite')
 *   },
 *   async init() {
 *     db.query('CREATE TABLE users …')
 *   },
 *   migrating(done) {
 *     showLoader('Migrating data', done)
 *   },
 *   stop() {
 *     db.close()
 *     updateAppWarning.show()
 *   }
 * })
 *   .type('users/create', async action => {
 *     await db.query(`INSERT INTO users …`)
 *   })
 * ```
 *
 * @param client Logux client.
 * @param name The name of the reducer to use in the storage version key.
 * @param version The current version to call migrations on new version.
 * @param callbacks The data migrations callbacks.
 */
export function createReducer(
  client: Client,
  name: string,
  version: number,
  callbacks: ReducerInitCallbacks
): Reducer

interface StorageActionListener<ListenAction extends Action, Value> {
  (
    prevValue: Value,
    action: ListenAction,
    meta: ClientMeta | MetaTime
  ): Value | Promise<Value>
}

interface StorageCallbacks {
  /**
   * Called when the stored value has an older version and is being cleaned
   * and reduced again from {@link StorageCallbacks#repeat} actions.
   *
   * @param done Promise resolved when the reducer is ready
   *             (the same as {@link StorageReducer#ready}).
   */
  migrating?(done: Promise<void>): void

  /**
   * Actions to reduce the value again after the version change.
   *
   * Metas need only `id` and `time`, so the same actions snapshot
   * can be passed to {@link CrdtDatabaseOptions#repeat} and reduced here,
   * even when the actions were restored from the tables
   * by {@link crdtTableToActions} and are not in the log anymore.
   *
   * ```js
   * createStorageReducer(client, 'menu', 1, [], {
   *   repeat: () => getSnapshot()
   * })
   * ```
   */
  repeat(): [Action, MetaTime][] | Promise<[Action, MetaTime][]>

  /**
   * Storage to keep the value and the reducer’s version instead
   * of `localStorage` (for instance, for React Native or tests).
   *
   * The value is synchronized with other tabs by `storage` events
   * only if the storage is `localStorage` itself.
   *
   * ```js
   * createStorageReducer(client, 'counter', 1, 0, {
   *   storage: memoryStorage,
   *   repeat() { … }
   * })
   * ```
   */
  storage?: PersistentStorage
}

interface Convertor<Value> {
  encode(value: Value): string
  decode(str: string): Value
}

interface StorageReducer<Value> {
  /**
   * The reduced value.
   *
   * Reduce will use value compare function from it:
   *
   * ```js
   * users.value.eq = (prev, next) => prev.join() === next.join()
   * ```
   */
  value: ReadableAtom<Value>

  /**
   * Stop the reducer: unsubscribe from the client, release the leader lock
   * and stop tracking `storage` events. The value is kept in the storage.
   */
  destroy(): void

  /**
   * Promise resolved when the value was loaded and all actions
   * from the log were reduced. It is also resolved when the reducer
   * became `outdated`.
   */
  readonly ready: Promise<void>

  status: ReadableAtom<ReducerMigrationStatus>

  type<TypeAction extends Action = Action>(
    type: TypeAction['type'],
    listener: StorageActionListener<TypeAction, Value>
  ): void
  type<Creator extends AbstractActionCreator>(
    actionCreator: Creator,
    listener: StorageActionListener<ReturnType<Creator>, Value>
  ): void
}

/**
 * Create a reducer that reduces actions into a single value stored in
 * `localStorage` (or in {@link StorageCallbacks#storage}). The value
 * is loaded on first run and kept in sync across tabs via `storage` events.
 *
 * The value is removed on {@link Client#clean} together with the log.
 *
 * ```ts
 * import { createStorageReducer } from '@logux/client'
 *
 * let counter = createStorageReducer(client, 'counter', 1, 0, {
 *   decode: s => parseInt(s, 10),
 *   encode: v => String(v),
 *   repeat() {
 *     return client.log.each(action => action.type === 'inc')
 *   }
 * })
 * counter.type<{ type: 'inc' }>('inc', prev => prev + 1)
 * ```
 */
export function createStorageReducer<Value extends string = string>(
  client: Client,
  name: string,
  version: number,
  initialValue: NoInfer<Value>,
  callbacks: StorageCallbacks
): StorageReducer<Value>
export function createStorageReducer<Value>(
  client: Client,
  name: string,
  version: number,
  initialValue: Value,
  callbacks: StorageCallbacks & Convertor<Value>
): StorageReducer<Value>
