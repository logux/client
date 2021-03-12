import { Client } from '../client/index.js'

/**
 * Highlight tabs on synchronization errors.
 *
 * ```js
 * import { attention } from '@logux/client'
 * attention(client)
 * ```
 *
 * @param client Observed Client instance.
 * @returns Unbind listener.
 */
export function attention(client: Client): () => void
