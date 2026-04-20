import type { Action } from '@logux/core'
import type { ReadableAtom } from 'nanostores'

import type {
  AbstractActionCreator,
  ClientActionListener,
  ClientMeta,
  Client
} from '../client/index.js'

interface ActionListener<ListenAction extends Action> {
  (action: ListenAction, meta: ClientMeta): void | Promise<void>
}

interface ReducerInitCallbacks {
  init?(): void | Promise<void>
  clean(
    oldVersion: number
  ):
    | void
    | Promise<void>
    | [Action, ClientMeta][]
    | Promise<[Action, ClientMeta][]>
  stop?(): void
}

type ReducerMigrationStatus = 'initializing' | 'updating' | 'outdated' | 'ready'

interface Reducer {
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
 * @param name The name of the reducer to use in localStorage version key.
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
    meta: ClientMeta
  ): Value | Promise<Value>
}

interface StorageCallbacks {
  repeat(): [Action, ClientMeta][] | Promise<[Action, ClientMeta][]>
}

interface Convertor<Value> {
  encode(value: Value): string
  decode(str: string): Value
}

interface StorageReducer<Value> {
  value: ReadableAtom<Value>

  status: ReadableAtom<MigrationStatus>

  type<TypeAction extends Action = Action>(
    type: TypeAction['type'],
    listener: StorageActionListener<TypeAction, Value>
  ): void
  type<Creator extends AbstractActionCreator>(
    actionCreator: Creator,
    listener: StorageActionListener<ReturnType<Creator>, Value>
  ): void
}

export function createStorageReducer<Value>(
  client: Client,
  name: string,
  version: number,
  initialValue: Value,
  callbacks: StorageCallbacks & Convertor<Value>
): StorageReducer<Value>
export function createStorageReducer<Value extends string>(
  client: Client,
  name: string,
  version: number,
  callbacks: StorageCallbacks
): StorageReducer<Value>
