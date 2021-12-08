import { SyncMapValues } from '@logux/actions'
import { MapStore } from 'nanostores'

import {
  LoadedSyncMapValue,
  SyncMapTemplate,
  SyncMapStore
} from '../sync-map-template/index.js'
import { Client } from '../client/index.js'

export type Filter<Value extends object> = {
  [Key in keyof Value]?: Value[Key]
}

export interface FilterOptions {
  listChangesOnly?: boolean
  singleSubscription?: boolean
}

export interface FilterStore<
  Value extends SyncMapValues = any
> extends MapStore<{
    list: LoadedSyncMapValue<Value>[]
    stores: Map<string, SyncMapStore<Value>>
    isEmpty: boolean
    isLoading: boolean
  }> {
  /**
   * While store is loading initial data from server or log.
   */
  readonly loading: Promise<void>
}

/**
 * Load list of `SyncMap` with simple key-value requirements.
 *
 * It will look for stores in loaded cache, log (for offline maps) and will
 * subscribe to list from server (for remote maps).
 *
 * ```js
 * import { createFilter } from '@logux/client'
 *
 * import { User } from '../store'
 *
 * let usersInProject = createFilter(client, User, { projectId })
 * await usersInProject.loading
 * console.log(usersInProject.get())
 * ```
 *
 * @param client Logux Client.
 * @param Template Store template from {@link syncMapTemplate}.
 * @param filter Key-value to filter stores.
 * @param opts Loading options.
 */
export function createFilter<Value extends SyncMapValues>(
  client: Client,
  Template: SyncMapTemplate<Value>,
  filter?: Filter<Value>,
  opts?: FilterOptions
): FilterStore<Value>
