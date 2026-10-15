import type { LoguxSubscribeAction, LoguxUndoAction } from '@logux/actions'
import type { AnyAction } from '@logux/core'

/**
 * Error on `logux/undo` action from the server.
 *
 * ```js
 * try {
 *   client.sync(action)
 * } catch (e) {
 *   if (e.name === 'LoguxUndoError') {
 *     console.log(e.action.action.type ' was undid')
 *   }
 * }
 * ```
 */
export class LoguxUndoError<
  RevertedAction extends LoguxUndoAction = LoguxUndoAction
> extends Error {
  /**
   * Server `logux/undo` action. It has origin actions (which was undid)
   * in `action.action`.
   *
   * ```js
   * console.log(error.action.action.type ' was undid')
   * ```
   */
  action: RevertedAction

  /**
   * The better way to check error, than `instanceof`.
   *
   * ```js
   * if (error.name === 'LoguxUndoError') {
   * ```
   */
  name: 'LoguxUndoError'

  /**
   * Check that error is `LoguxUndoError`, optionally with specific `reason`
   * of the server’s `logux/undo` action. It narrows the error type,
   * so you don’t need to look into the error message.
   *
   * ```js
   * try {
   *   await client.sync(action)
   * } catch (e) {
   *   if (LoguxUndoError.is(e, 'notFound')) {
   *     showNotFound(e.action.action)
   *   } else {
   *     throw e
   *   }
   * }
   * ```
   *
   * @param thrown Caught error.
   * @param reason Expected `reason` of `logux/undo` action.
   * @returns `true` for `LoguxUndoError` with this reason.
   */
  static is<Reason extends string = string>(
    thrown: unknown,
    reason?: Reason
  ): thrown is LoguxUndoError<LoguxUndoAction<AnyAction, Reason>>

  constructor(action: RevertedAction)
}

export type ChannelNotFoundError = LoguxUndoError<
  LoguxUndoAction<LoguxSubscribeAction, 'notFound'>
>

export type ChannelDeniedError = LoguxUndoError<
  LoguxUndoAction<LoguxSubscribeAction, 'denied'>
>

export type ChannelServerError = LoguxUndoError<
  LoguxUndoAction<LoguxSubscribeAction, 'error'>
>

export type ChannelError =
  | ChannelDeniedError
  | ChannelNotFoundError
  | ChannelServerError
