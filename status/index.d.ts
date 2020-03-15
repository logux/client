import { Action } from '@logux/core'

import { Client, ClientMeta } from '../client'

interface statusListener {
  (
    current: 'synchronized' | 'synchronizedAfterWait' | 'disconnected' |
             'connecting' | 'connectingAfterWait' | 'protocolError' |
             'syncError' | 'error' | 'denied' |  'wait',
    details: undefined | Error | { action: Action, meta: ClientMeta }
  ): void
}

type StatusOptions = {
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
export function status (
  client: Client, callback: statusListener, options?: StatusOptions
): () => void

/**
 * Low-level function to show Logux synchronization status with your custom UI.
 * It is used in {@link badge} widget.
 *
 * @param {Client} client Observed Client instance.
 * @param {statusReceiver} callback Status callback.
 * @param {object} [options] Options.
 * @param {number} [options.duration=3000] `synchronizedAfterWait` duration.
 *
 * @return {function} Unbind status listener.
 *
 * @example
 * import status from '@logux/client/status'
 * status(client, current => {
 *   updateUI(current)
 * })
 */


/**
 * @callback statusReceiver
 * @param {
  *   "synchronized"|"synchronizedAfterWait"|"disconnected"|"wait"|"error"|
  *   "connecting"|"connectingAfterWait"|"syncError"|"denied"|"protocolError"
  * } type Status type.
  * @param {object|undefined} details Status details.
  */
