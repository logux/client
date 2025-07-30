import type { Action } from '@logux/core'

import type { Client, ClientMeta } from '../client/index.js'

export type StatusValue =
  | 'connecting'
  | 'connectingAfterWait'
  | 'denied'
  | 'disconnected'
  | 'error'
  | 'protocolError'
  | 'sending'
  | 'sendingAfterWait'
  | 'syncError'
  | 'synchronized'
  | 'synchronizedAfterWait'
  | 'wait'

interface StatusListener {
  (
    current: StatusValue,
    details: { action: Action; meta: ClientMeta } | { error: Error } | undefined
  ): void
}

interface StatusOptions {
  /**
   * Synchronized state duration. Default is `3000`.
   */
  duration?: number
}

/**
 * Low-level function to show Logux synchronization status with your custom UI.
 * It is used in {@link badge} widget.
 *
 * ```js
 * import { status } from '@logux/client'
 * status(client, current => {
 *   updateUI(current)
 * })
 * ```
 *
 * @param client Observed Client instance.
 * @param messages Disable specific message types.
 * @returns Unbind listener.
 */
export function status(
  client: Client,
  callback: StatusListener,
  options?: StatusOptions
): () => void
