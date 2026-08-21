import type { Client, ClientMeta } from '../client/index.js'

/**
 * Add `shadow` action to the log. It is useful for client to clean
 * server from encrypted `zero` actions.
 *
 * It replaces materialized action in the log, keeping its ID,
 * reasons and indexes, but dropping the body.
 *
 * By tracking `shadow` reasons you can detect when you can ask server
 * to remove original action.
 *
 * ```js
 * import { shadow, zeroClean } from '@logux/actions'
 * import { replaceWithShadow } from '@logux/client'
 *
 * client.log.type('logux/processed', async processed => {
 *   let [action, meta] = await client.log.byId(processed.id)
 *   if (action) await replaceWithShadow(client, meta)
 * })
 *
 * client.log.on('clean', action => {
 *   if (shadow.match(action)) {
 *     client.log.add(zeroClean({ ids: [action.id] }), { sync: true })
 *   }
 * })
 * ```
 *
 * @param client Logux Client.
 * @param meta Meta of the original action.
 * @returns Meta of the added shadow action.
 */
export function replaceWithShadow(
  client: Client,
  meta: ClientMeta
): Promise<ClientMeta>
