import type { LoguxNotFoundError, SyncMapValues } from '@logux/actions'
import type { StoreValue } from 'nanostores'
import type {
  App,
  Component,
  ComponentPublicInstance,
  ComputedRef,
  DeepReadonly,
  InjectionKey,
  Ref
} from 'vue'

import type { Client } from '../client/index.js'
import type { Filter, FilterOptions, FilterStore } from '../create-filter/index.js'
import type { ChannelError } from '../logux-undo-error/index.js'
import type {
  SyncMapTemplate,
  SyncMapTemplateLike,
  SyncMapValue
} from '../sync-map-template/index.js'

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
 * ```html
 * <script>
 * import { useClient } from '@logux/client/vue'
 *
 * import { User } from '../stores/user'
 *
 * let client = useClient()
 * let onAdd = data => {
 *   User.create(client, data)
 * }
 * </script>
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
 * import { User } from '../stores/user'
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
 * @param Template Store template.
 * @param id Store ID.
 * @param args Other store arguments.
 * @returns Store value.
 */
export function useSync<Value extends SyncMapValues>(
  Template: SyncMapTemplateLike<Value>,
  id: Refable<string>
): ReadonlyRef<SyncMapValue<Value>>
export function useSync<Value extends object, Args extends any[]>(
  Template: SyncMapTemplateLike<Value, Args>,
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
 * import { User } from '../stores/user'
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
 * @param Template Store class.
 * @param filter Key-value filter for stores.
 * @param opts Filter options.
 * @returns Filter store to use with map.
 */
export function useFilter<Value extends SyncMapValues>(
  Template: SyncMapTemplate<Value>,
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
  code: ReadonlyRef<number | undefined>
  error: ReadonlyRef<{
    data: ChannelError | LoguxNotFoundError
    info: string
    instance: ComponentPublicInstance
  } | null>
}

/**
 * Returns user's current authentication state and ID.
 *
 * ```html
 * <template>
 *   <user v-if="isAuthenticated" :id="userId" />
 *   <sign-in v-else />
 * </template>
 *
 * <script>
 * import { useAuth } from '@logux/client/vue'
 *
 * export default () => {
 *   let { isAuthenticated, userId } = useAuth()
 *   return { isAuthenticated, userId }
 * }
 * </script>
 * ```
 *
 * @param client Logux Client instance.
 */
export function useAuth(client?: Client): {
  isAuthenticated: ComputedRef<boolean>
  userId: ComputedRef<string>
}
