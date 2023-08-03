import type { SyncMapValues } from '@logux/actions'
import type { Action, Meta } from '@logux/core'
import type { MapCreator, MapStore } from 'nanostores'

import type { Client } from '../client/index.js'

interface SyncMapStoreExt {
  /**
   * Logux Client instance.
   */
  readonly client: Client

  /**
   * Meta from create action if the store was created locally.
   */
  createdAt?: Meta

  /**
   * While store is loading initial data from server or log.
   */
  readonly loading: Promise<void>

  /**
   * Does store keep data in the log after store is destroyed.
   */
  offline: boolean

  /**
   * Name of map class.
   */
  readonly plural: string

  /**
   * Does store use server to load and save data.
   */
  remote: boolean
}

export type LoadedSyncMapValue<Value extends SyncMapValues> = Value & {
  id: string
  isLoading: false
}

export type SyncMapValue<Value extends SyncMapValues> =
  | { id: string; isLoading: true }
  | LoadedSyncMapValue<Value>

export type SyncMapStore<Value extends SyncMapValues = any> = MapStore<
  SyncMapValue<Value>
> &
  SyncMapStoreExt

export interface SyncMapTemplate<
  Value extends SyncMapValues = any,
  StoreExt = {}
> extends MapCreator {
  (
    id: string,
    client: Client,
    ...args: [] | [Action, Meta, boolean | undefined]
  ): SyncMapStore<Value> & StoreExt
  cache: {
    [id: string]: SyncMapStore<Value> & StoreExt
  }
  offline: boolean
  readonly plural: string
  remote: boolean
}

export interface SyncMapTemplateLike<
  Value extends object = any,
  Args extends any[] = []
> {
  (id: string, client: Client, ...args: Args): MapStore<Value>
}

/**
 * CRDT LWW Map. It can use server validation or be fully offline.
 *
 * The best option for classic case with server and many clients.
 * Store will resolve client’s edit conflicts with last write wins strategy.
 *
 * ```ts
 * import { syncMapTemplate } from '@logux/client'
 *
 * export const User = syncMapTemplate<{
 *   login: string,
 *   name?: string,
 *   isAdmin: boolean
 * }>('users')
 * ```
 *
 * @param plural Plural store name. It will be used in action type
 *               and channel name.
 * @param opts Options to disable server validation or keep actions in log
 *             for offline support.
 */
export function syncMapTemplate<Value extends SyncMapValues>(
  plural: string,
  opts?: {
    offline?: boolean
    remote?: boolean
  }
): SyncMapTemplate<Value>

/**
 * Send create action to the server or to the log.
 *
 * Server will create a row in database on this action. {@link FilterStore}
 * will update the list.
 *
 * ```js
 * import { createSyncMap } from '@logux/client'
 *
 * showLoader()
 * await createSyncMap(client, User, {
 *   id: nanoid(),
 *   login: 'test'
 * })
 * hideLoader()
 * ```
 *
 * @param client Logux Client instance.
 * @param Template Store template from {@link syncMapTemplate}.
 * @param value Initial value.
 * @return Promise until server validation for remote classes
 *         or saving action to the log of fully offline classes.
 */
export function createSyncMap<Value extends SyncMapValues>(
  client: Client,
  Template: SyncMapTemplate<Value>,
  value: Value & { id: string }
): Promise<void>

/**
 * Send create action and build store instance.
 *
 * ```js
 * import { buildNewSyncMap } from '@logux/client'
 *
 * let userStore = buildNewSyncMap(client, User, {
 *   id: nanoid(),
 *   login: 'test'
 * })
 * ```
 *
 * @param client Logux Client instance.
 * @param Template Store template from {@link syncMapTemplate}.
 * @param value Initial value.
 * @return Promise with store instance.
 */
export function buildNewSyncMap<Value extends SyncMapValues>(
  client: Client,
  Template: SyncMapTemplate<Value>,
  value: Value & { id: string }
): Promise<SyncMapStore<Value>>

/**
 * Change store without store instance just by store ID.
 *
 * ```js
 * import { changeSyncMapById } from '@logux/client'
 *
 * let userStore = changeSyncMapById(client, User, 'user:4hs2jd83mf', {
 *   name: 'New name'
 * })
 * ```
 *
 * @param client Logux Client instance.
 * @param Template Store template from {@link syncMapTemplate}.
 * @param id Store’s ID.
 * @param diff Store’s changes.
 * @return Promise until server validation for remote classes
 *         or saving action to the log of fully offline classes.
 */
export function changeSyncMapById<Value extends SyncMapValues>(
  client: Client,
  Template: SyncMapTemplate<Value>,
  id: { id: string } | string,
  diff: Partial<Value>
): Promise<void>
export function changeSyncMapById<
  Value extends SyncMapValues,
  ValueKey extends keyof Value
>(
  client: Client,
  Template: SyncMapTemplate<Value>,
  id: { id: string } | string,
  key: ValueKey,
  value: Value[ValueKey]
): Promise<void>

/**
 * Change keys in the store’s value.
 *
 * ```js
 * import { changeSyncMap } from '@logux/client'
 *
 * showLoader()
 * await changeSyncMap(userStore, { name: 'New name' })
 * hideLoader()
 * ```
 *
 * @param store Store’s instance.
 * @param diff Store’s changes.
 * @return Promise until server validation for remote classes
 *         or saving action to the log of fully offline classes.
 */
export function changeSyncMap<Value extends SyncMapValues>(
  store: SyncMapStore<Value>,
  diff: Partial<Omit<Value, 'id'>>
): Promise<void>
export function changeSyncMap<
  Value extends SyncMapValues,
  ValueKey extends Exclude<keyof Value, 'id'>
>(
  store: SyncMapStore<Value>,
  key: ValueKey,
  value: Value[ValueKey]
): Promise<void>

/**
 * Delete store without store instance just by store ID.
 *
 * ```js
 * import { deleteSyncMapById } from '@logux/client'
 *
 * showLoader()
 * await deleteSyncMapById(client, User, 'user:4hs2jd83mf')
 * ```
 *
 * @param client Logux Client instance.
 * @param Template Store template from {@link syncMapTemplate}.
 * @param id Store’s ID.
 * @return Promise until server validation for remote classes
 *         or saving action to the log of fully offline classes.
 */
export function deleteSyncMapById(
  client: Client,
  Template: SyncMapTemplate,
  id: { id: string } | string
): Promise<void>

/**
 * Delete store.
 *
 * ```js
 * import { deleteSyncMap } from '@logux/client'
 *
 * showLoader()
 * await deleteSyncMap(User)
 * ```
 *
 * @param store Store’s instance.
 * @return Promise until server validation for remote classes
 *         or saving action to the log of fully offline classes.
 */
export function deleteSyncMap(store: SyncMapStore): Promise<void>
