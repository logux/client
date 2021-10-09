import { Context as PreactContext, Component, ComponentType } from 'preact'
import { SyncMapValues, LoguxNotFoundError } from '@logux/actions'
import { StoreValue, MapBuilder } from 'nanostores'

import {
  ChannelNotFoundError,
  ChannelDeniedError,
  ChannelError
} from '../logux-undo-error/index.js'
import { FilterOptions, FilterStore, Filter } from '../create-filter/index.js'
import { SyncMapBuilder, SyncMapValue } from '../define-sync-map/index.js'
import { Client } from '../client/index.js'
import { AuthStore } from '../create-auth/index.js'

/**
 * Context to send Logux Client or object space to components deep in the tree.
 *
 * ```js
 * import { ClientContext, ChannelErrors } from '@logux/client/preact'
 * import { CrossTabClient } from '@logux/client'
 *
 * let client = new CrossTabClient(…)
 *
 * render(
 *  <ClientContext.Provider value={client}>
 *    <ChannelErrors NotFound={Page404} AccessDenied={Page403}>
 *      <App />
 *    </ChannelErrors>
 *  </ClientContext.Provider>,
 *  document.body
 * )
 * ```
 */
export const ClientContext: PreactContext<Client>

/**
 * Hook to return Logux client, which you set by `<ClientContext.Provider>`.
 *
 * ```js
 * import { useClient } from '@logux/client/preact'
 *
 * import { User } from '../stores/user'
 *
 * export const NewUserForm = () => {
 *   let client = useClient()
 *   let onAdd = data => {
 *     User.create(client, data)
 *   }
 * }
 * ```
 */
export function useClient(): Client

/**
 * Show error message to user on subscription errors in components
 * deep in the tree.
 *
 * ```js
 * import { ChannelErrors } from '@logux/client/preact'
 *
 * export const App: FC = () => {
 *   return <>
 *     <SideMenu />
 *     <ChannelErrors
 *       NotFound={NotFoundPage}
 *       AccessDenied={AccessDeniedPage}
 *       Error={ServerErrorPage}
 *     >
 *       <Layout />
 *     </ChannelErrors>
 *   <>
 * }
 * ```
 */
export class ChannelErrors extends Component<{
  NotFound?: ComponentType<{ error: ChannelNotFoundError | LoguxNotFoundError }>
  AccessDenied?: ComponentType<{ error: ChannelDeniedError }>
  Error?: ComponentType<{ error: ChannelError }>
}> {}

/**
 * Create store by ID, subscribe and get store’s value.
 *
 * ```js
 * import { useSync } from '@logux/client/preact'
 *
 * import { User } from '../stores/user'
 *
 * export const UserPage: FC = ({ id }) => {
 *   let user = useSync(User, id)
 *   if (user.isLoading) {
 *     return <Loader />
 *   } else {
 *     return <h1>{user.name}</h1>
 *   }
 * }
 * ```
 *
 * @param Builder Store builder.
 * @param id Store ID.
 * @param args Other store arguments.
 * @returns Store value.
 */
export function useSync<Value extends SyncMapValues>(
  Builder: SyncMapBuilder<Value>,
  id: string
): SyncMapValue<Value>
export function useSync<Value extends object, Args extends any[]>(
  Builder: MapBuilder<Value, [Client, ...Args]>,
  id: string,
  ...args: Args
): Value

/**
 * The way to {@link createFilter} in React.
 *
 * ```js
 * import { useFilter } from '@logux/client/preact'
 *
 * import { User } from '../stores/user'
 *
 * export const Users = ({ projectId }) => {
 *   let users = useFilter(User, { projectId })
 *   return <div>
 *     {users.list.map(user => <User user={user} />)}
 *     {users.isLoading && <Loader />}
 *   </div>
 * }
 * ```
 *
 * @param Builder Store class.
 * @param filter Key-value filter for stores.
 * @param opts Filter options.
 * @returns Filter store to use with map.
 */
export function useFilter<Value extends SyncMapValues>(
  Builder: SyncMapBuilder<Value>,
  filter?: Filter<Value>,
  opts?: FilterOptions
): StoreValue<FilterStore<Value>>

/**
 * Hook to return user's current authentication state and ID.
 *
 * ```js
 * import { useAuth } from '@logux/client/preact'
 *
 * export const UserPage = () => {
 *   let { isAuthenticated, userId } = useAuth()
 *   if (isAuthenticated) {
 *     return <User id={userId} />
 *   } else {
 *     return <Loader />
 *   }
 * }
 * ```
 */
export function useAuth(): StoreValue<AuthStore>
