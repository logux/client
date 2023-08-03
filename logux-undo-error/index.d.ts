import type { LoguxSubscribeAction, LoguxUndoAction } from '@logux/actions'

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
