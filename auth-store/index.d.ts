import { Store } from '@logux/state'

import { Client } from '../client/index.js'

export function Auth(client: Client): Store<{
  userId: string
  isAuthenticated: boolean
}>
