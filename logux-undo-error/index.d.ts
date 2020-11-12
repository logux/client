import { Action, AnyAction } from '@logux/core'

/**
 *
 */
export type LoguxUndoAction<A extends Action = AnyAction> = {
  type: 'logux/undo'
  id: string
  reason: string
  action: A
}

/**
 *
 */
export class LoguxUndoError<A extends Action = LoguxUndoAction> extends Error {
  /**
   *
   */
  name: 'LoguxUndoError'

  /**
   *
   */
  action: A
}
