import { Action, AnyAction } from '@logux/core'

export type LoguxUndoAction<
  A extends Action = AnyAction,
  R extends string = string
> = {
  type: 'logux/undo'
  id: string
  reason: R
  action: A
}

export type LoguxSubscribeAction = {
  type: 'logux/subscribe'
  channel: string
  since?: {
    id: string
    time: number
  }
}

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
  A extends LoguxUndoAction = LoguxUndoAction
> extends Error {
  /**
   * The better way to check error, than `instanceof`.
   *
   * ```js
   * if (error.name === 'LoguxUndoError') {
   * ```
   */
  name: 'LoguxUndoError'

  /**
   * Server `logux/undo` action. It has origin actions (which was undid)
   * in `action.action`.
   *
   * ```js
   * console.log(error.action.action.type ' was undid')
   * ```
   */
  action: A

  constructor (action: A)
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
