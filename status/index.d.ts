import type { LoguxUndoAction } from '@logux/actions'

import type { Client, ClientMeta } from '../client/index.js'

export type StatusValue =
  | 'connecting'
  | 'connectingAfterWait'
  | 'denied'
  | 'disconnected'
  | 'error'
  | 'protocolError'
  | 'receiving'
  | 'sending'
  | 'sendingAfterWait'
  | 'syncError'
  | 'synchronized'
  | 'synchronizedAfterWait'
  | 'wait'
  | 'wrongCredentials'

export interface StatusReceiving {
  done: number
  total: number
}

type StatusWithoutDetails = Exclude<
  StatusValue,
  'denied' | 'error' | 'receiving' | 'syncError'
>

type StatusEvent =
  | [
      current: 'denied' | 'error',
      details: { action: LoguxUndoAction; meta: ClientMeta }
    ]
  | [current: 'receiving', details: StatusReceiving]
  | [current: 'syncError', details: { error: Error }]
  | [current: StatusWithoutDetails, details: undefined]

interface StatusListener {
  (...event: StatusEvent): void
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
 * On `receiving` the details have the download progress:
 *
 * ```js
 * import { status } from '@logux/client'
 * status(client, (current, details) => {
 *   updateUI(current)
 *   if (current === 'receiving') {
 *     setProgress(details.done / details.total)
 *   }
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
// The overloads can’t be merged into a union: it will break the types
// of the callback’s arguments
export function status(
  client: Client,
  // oxlint-disable-next-line typescript/unified-signatures
  callback: (current: StatusValue) => void,
  options?: StatusOptions
): () => void
