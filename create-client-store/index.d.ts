import { MapStore, Atom } from 'nanostores'

import { Client } from '../client/index.js'

interface CreateClientStore {
  /**
   * Create stores to keep client instance and update it on user ID changes.
   *
   * ```js
   * import { createClientStore, Client, log } from '@logux/client'
   * import { persistentMap } from '@nanostores/persistent'
   *
   * let sessionStore = persistentMap<{ userId: string }>('session:', {
   *   userId: 'anonymous'
   * })
   *
   * export const clientStore = createClientStore(sessionStore, session => {
   *   let client new Client({
   *     subprotocol: SUBPROTOCOL,
   *     server: 'ws://example.com',
   *     userId: session.userId
   *   })
   *   log(client)
   *   return client
   * })
   * ```
   *
   * @param userIdStore Store with object and `userId` key.
   * @param builder Callback which return client
   * @returns Atom store with client
   */
  <UserId extends { userId: string }>(
    userIdStore: MapStore<UserId>,
    builder: (value: UserId) => Client
  ): Atom<Client>

  <UserId extends { userId?: string | undefined }>(
    userIdStore: MapStore<UserId>,
    builder: (value: UserId) => Client | undefined
  ): Atom<Client | undefined>
}

export const createClientStore: CreateClientStore
