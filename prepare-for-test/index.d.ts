import type { SyncMapValues } from '@logux/actions'
import type { MapStore } from 'nanostores'

import type { Client } from '../client/index.js'
import type {
  SyncMapStore,
  SyncMapTemplate,
  SyncMapTemplateLike
} from '../sync-map-template/index.js'

interface PrepareForTest {
  <Value extends object>(
    client: Client,
    Template: SyncMapTemplateLike<Value>,
    value: Omit<Value, 'id'> & { id?: string }
  ): MapStore<Value>
  <Value extends SyncMapValues>(
    client: Client,
    Template: SyncMapTemplate<Value>,
    value: Omit<Value, 'id'> & { id?: string }
  ): SyncMapStore<Value>
}

/**
 * Create and load stores to builder’s cache to use them in tests
 * or storybook.
 *
 * ```js
 * import { prepareForTest, cleanStores, TestClient } from '@logux/client'
 *
 * import { User } from '../store'
 *
 * let client = new TestClient('10')
 *
 * beforeEach(() => {
 *   prepareForTest(client, User, { name: 'Test user 1' })
 *   prepareForTest(client, User, { name: 'Test user 2' })
 * })
 *
 * afterEach(() => {
 *   cleanStores(User)
 * })
 * ```
 *
 * @param client `TestClient` instance.
 * @param Template Store builder.
 * @param value Store values.
 * @returns The mocked store.
 */
export const prepareForTest: PrepareForTest

/**
 * Disable loader for filter for this builder.
 *
 * ```js
 * import { emptyInTest, cleanStores } from '@logux/client'
 *
 * beforeEach(() => {
 *   prepareForTest(client, User, { name: 'Test user 1' })
 *   prepareForTest(client, User, { name: 'Test user 2' })
 * })
 *
 * afterEach(() => {
 *   cleanStores(User)
 * })
 * ```
 *
 * @param Template Store builder.
 */
export function emptyInTest(Template: SyncMapTemplate): void
