import type { Client } from '../client/index.js'

interface FaviconLinks {
  /**
   * Error favicon link.
   */
  error?: string

  /**
   * Default favicon link. By default, it will be taken from current favicon.
   */
  normal?: string

  /**
   * Offline favicon link.
   */
  offline?: string
}

/**
 * Change favicon to show Logux synchronization status.
 *
 * ```js
 * import { favicon } from '@logux/client'
 * favicon(client, {
 *   normal: '/favicon.ico',
 *   offline: '/offline.ico',
 *   error: '/error.ico'
 * })
 * ```
 *
 * @param client Observed Client instance.
 * @param links Favicon links.
 * @returns Unbind listener.
 */
export function favicon(client: Client, links: FaviconLinks): () => void
