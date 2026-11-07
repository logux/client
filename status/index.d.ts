import type { LoguxUndoAction } from '@logux/actions'

import type { Client, ClientMeta } from '../client/index.js'

export type StatusValue =
  | 'connecting'
  | 'connectingAfterWait'
  | 'denied'
  | 'disconnected'
  | 'error'
  | 'outdated'
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
  type?: never
}

interface StatusErrorBase {
  /**
   * Error message or the type of the undone action.
   */
  message: string
  type: 'error'
}

/**
 * Details of `denied` and `error` statuses.
 */
export interface StatusUndoError extends StatusErrorBase {
  /**
   * `logux/undo` action from the server.
   */
  action: LoguxUndoAction
  /**
   * Meta of `logux/undo` action.
   */
  meta: ClientMeta
}

/**
 * Details of `syncError`, `protocolError`, `outdated`
 * and `wrongCredentials` statuses.
 */
export interface StatusSyncError extends StatusErrorBase {
  error: Error
}

/**
 * Details of every error status.
 */
export type StatusError = StatusSyncError | StatusUndoError

export type StatusErrorValue =
  | 'denied'
  | 'error'
  | 'outdated'
  | 'protocolError'
  | 'syncError'
  | 'wrongCredentials'

type StatusWithoutDetails = Exclude<
  StatusValue,
  'receiving' | StatusErrorValue
>

type StatusEvent =
  | [current: 'receiving', details: StatusReceiving]
  | [current: 'denied' | 'error', details: StatusUndoError]
  | [
      current: Exclude<StatusErrorValue, 'denied' | 'error'>,
      details: StatusSyncError
    ]
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
 * `outdated` means that the server has a newer subprotocol and does not
 * support the client’s one. The user needs to reload the page
 * to get the new client. `protocolError` is the same for Logux protocol.
 *
 * On `receiving` the details have the download progress. Every error
 * status has details with the same shape: `type: 'error'` and `message`
 * with the error message or the type of the undone action.
 *
 * ```js
 * import { status } from '@logux/client'
 * status(client, (current, details) => {
 *   updateUI(current)
 *   if (current === 'receiving') {
 *     setProgress(details.done / details.total)
 *   }
 *   if (details?.type === 'error') showError(details.message)
 * })
 * ```
 *
 * @param client Observed Client instance.
 * @param callback Status changes callback.
 * @param options Status options.
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
