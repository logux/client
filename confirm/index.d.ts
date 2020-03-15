import { Client } from '../client'

/**
 * Show confirm popup, when user close tab with non-synchronized actions.
 *
 * ```js
 * import { confirm } from '@logux/client'
 * confirm(client)
 * ```
 *
 * @param client Observed Client instance.
 * @returns Unbind listener.
 */
export function confirm (client: Client): () => void
