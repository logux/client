import {
  ComponentPublicInstance,
  DeepReadonly,
  InjectionKey,
  Component,
  App,
  Ref
} from 'vue'
import { StoreValue, MapBuilder } from '@logux/state'
import { SyncMapValues } from '@logux/actions'

import { FilterOptions, FilterStore, Filter } from '../create-filter/index.js'
import { SyncMapBuilder, SyncMapValue } from '../define-sync-map/index.js'
import { ChannelError } from '../logux-undo-error/index.js'
import { Client } from '../client/index.js'

export type Refable<Type> = Ref<Type> | Type
type ReadonlyRef<Type> = DeepReadonly<Ref<Type>>

export const ClientKey: InjectionKey<Client>
export const ErrorsKey: InjectionKey<ChannelErrorsSlotProps>

/**
 * Plugin that injects Logux Client into all components within the application.
 *
 * ```js
 * import { createApp } from 'vue'
 * import { loguxPlugin } from '@logux/client/vue'
 * import { CrossTabClient } from '@logux/client'
 *
 * let client = new CrossTabClient(…)
 * let app = createApp(…)
 *
 * app.use(loguxPlugin, client)
 * ```
 */
export function loguxPlugin(app: App, client: Client): void

/**
 * Returns the Logux Client instance.
 *
 * ```js
 * let client = useClient()
 * let onAdd = data => {
 *   Post.create(client, data)
 * }
 * ```
 */
export function useClient(): Client

/**
 * Create store by ID, subscribe to store changes and get store’s value.
 *
 * ```html
 * <template>
 *   <loader v-if="user.isLoading" />
 *   <h1 v-else>{{ user.name }}</h1>
 * </template>
 *
 * <script>
 * import { useSync } from '@logux/client/vue'
 *
 * import { User } from '../store'
 *
 * export default {
 *   props: ['id'],
 *   setup (props) {
 *     let user = useSync(User, props.id)
 *     return { user }
 *   }
 * }
 * </script>
 * ```
 *
 * @param Builder Store builder.
 * @param id Store ID.
 * @param args Other store arguments.
 * @returns Store value.
 */
export function useSync<Value extends SyncMapValues>(
  Builder: SyncMapBuilder<Value>,
  id: Refable<string>
): ReadonlyRef<SyncMapValue<Value>>
export function useSync<Value extends object, Args extends any[]>(
  Builder: MapBuilder<Value, [Client, ...Args]>,
  id: Refable<string>,
  ...args: Args
): ReadonlyRef<Value>

/**
 * The way to {@link createFilter} in Vue.
 *
 * ```html
 * <template>
 *   <loader v-if="users.isLoading" />
 *   <user v-else v-for="user in users" :user="user" />
 * </template>
 *
 * <script>
 * import { useFilter } from '@logux/client/vue'
 *
 * import { User } from '../store'
 *
 * export default {
 *   props: ['projectId'],
 *   setup (props) {
 *     let users = useFilter(User, { projectId: props.projectId })
 *     return { users }
 *   }
 * }
 * </script>
 * ```
 *
 * @param Builder Store class.
 * @param filter Key-value filter for stores.
 * @param opts Filter options.
 * @returns Filter store to use with map.
 */
export function useFilter<Value extends SyncMapValues>(
  Builder: SyncMapBuilder<Value>,
  filter?: Refable<Filter<Value>>,
  opts?: Refable<FilterOptions>
): ReadonlyRef<StoreValue<FilterStore<Value>>>

/**
 * Show error message to user on subscription errors in components
 * deep in the tree.
 *
 * ```html
 * <template>
 *   <channel-errors v-slot="{ code, error }">
 *     <layout v-if="!error" />
 *     <error v-else-if="code === 500" />
 *     <error-not-found v-else-if="code === 404" />
 *     <error-access-denied v-else-if="code === 403" />
 *   </channel-errors>
 * </template>
 *
 * <script>
 * import { ChannelErrors } from '@logux/client/vue'
 *
 * export default {
 *   components: { ChannelErrors }
 * }
 * </script>
 * ```
 */
export const ChannelErrors: Component

export interface ChannelErrorsSlotProps {
  error: ReadonlyRef<{
    data: ChannelError
    instance: ComponentPublicInstance
    info: string
  } | null>
  code: ReadonlyRef<number | null>
}
