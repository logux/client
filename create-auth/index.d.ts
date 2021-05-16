import { Store } from '@logux/state'

import { Client } from '../client/index.js'

export type Auth = Store<{
  userId: string
  isAuthenticated: boolean
}>

export function createAuth(client: Client): Auth
