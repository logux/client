import { Action, AnyAction, Meta, TestLog } from '@logux/core'

/**
 * Virtual server to test client.
 *
 * ```js
 * let client = new TestClient()
 * client.server //=> TestServer
 * ```
 */
export class TestServer {
  /**
   * All actions recieved from the client.
   *
   * ```js
   * expect(client.server.log.actions()).toEqual([
   *   { type: 'logux/subscribe', channel: 'users/10' }
   * ])
   * ```
   */
  log: TestLog

  /**
   * Response with `logux/undo` instead of `logux/process` on next action
   * from the client.
   *
   * ```js
   * client.server.undoNext()
   * user.rename('Another name')
   * await delay(10)
   * expect(user.name).toEqual('Old name')
   * ```
   *
   * @param reason Optional code for reason. Default is `'error'`.
   * @param extra Extra fields to `logux/undo` action.
   */
  undoNext(reason?: string, extra?: object): void

  /**
   * Response with `logux/undo` instead of `logux/process` on receiving
   * specific action.
   *
   * ```js
   * client.server.undoAction(
   *   { type: 'rename', userId: '10', value: 'Bad name' }
   * )
   * user.rename('Good name')
   * user.rename('Bad name')
   * await delay(10)
   * expect(user.name).toEqual('Good name')
   * ```
   *
   * @param action Action to be undone on receiving
   * @param reason Optional code for reason. Default is `'error'`.
   * @param extra Extra fields to `logux/undo` action.
   */
  undoAction<RevertedAction extends Action = AnyAction>(
    action: RevertedAction,
    reason?: string,
    extra?: object
  ): void

  /**
   * Define server’s responses for specific channel.
   *
   * Second call with the same channel name will override previous data.
   *
   * ```js
   *   client.server.onChannel('users/10', [
   *     { type: 'users/name', userId: 10, value: 'New name' }
   *   ])
   *   let user = new UserStore(client, '10')
   *   await delay(10)
   *   expect(user.name).toEqual('New name')
   * ```
   *
   * @param channel The channel name.
   * @param response Actions to send back on subscription.
   */
  onChannel(
    channel: string,
    response: AnyAction | AnyAction[] | [AnyAction, Partial<Meta>][]
  ): void

  /**
   * Set channels for client’s actions.
   * @param type Action type.
   * @param resend Callback returns channel name.
   */
  resend<ResentAction extends Action = AnyAction>(
    type: ResentAction['type'],
    resend: (action: ResentAction, meta: Meta) => string | string[]
  ): void

  /**
   * Stop to response with `logux/processed` on all new action
   * and send `logux/processed` for all received actions when `test`
   * callback will be finished.
   *
   * ```js
   * await client.server.freezeProcessing(() => {
   *   user.rename('Another name')
   *   expect(user.nameIsSaving).toBe(true)
   * })
   * await delay(10)
   * expect(user.nameIsSaving).toBe(false)
   * ```
   *
   * @param test Function, where server will not send `logux/processed`.
   * @returns Promise until `test` will be finished.
   */
  freezeProcessing(test: () => Promise<void>): Promise<void>

  /**
   * Send action to all connected clients.
   *
   * ```js
   * client.server.sendAll(action)
   * ```
   *
   * @param action Action.
   * @param meta Action‘s meta.
   */
  sendAll<SentAction extends Action = AnyAction>(
    action: SentAction,
    meta?: Partial<Meta>
  ): Promise<void>
}
