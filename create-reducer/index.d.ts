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
