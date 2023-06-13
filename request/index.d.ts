import type { Action, AnyAction } from '@logux/core'

import type { ClientOptions } from '../client/index.js'

export interface RequestOptions extends Omit<ClientOptions, 'userId'> {
  userId?: string
}

/**
 * Create temporary client instance, send an action, wait response action
 * from the server and destroy client.
 *
 * Useful for simple actions like signin or signup.
 *
 * ```js
 * import { request } from '@logux/client'
 *
 * let action = { type: 'signin', login, password }
 *
 * request(action, {
 *   server: 'wss://example.com',
 *   subprotocol: '1.0.0
 * }).then(response => {
 *   saveToken(response.token)
 * }).catch(error => {
 *   showError(error.action.reason)
 * })
 * ```
 *
 * @param action Action which we need to send to the server.
 * @return Action of server response.
 */
export function request<SentAction extends Action = Action>(
  action: AnyAction,
  opts: RequestOptions
): Promise<SentAction>
