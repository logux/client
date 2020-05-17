import { LogStore } from '@logux/core'

/**
 * `IndexedDB` store for Logux log.
 *
 * ```js
 * import { IndexedStore } from '@logux/client'
 * const client = new CrossTabClient({
 *   …,
 *   store: new IndexedStore()
 * })
 * ```
 *
 * ```js
 * import IndexedStore from '@logux/client/indexed-store'
 * const createStore = createLoguxCreator({
 *   …,
 *   store: new IndexedStore()
 * })
 * ```
 */
export class IndexedStore extends LogStore {
  /**
   * @param name Database name to run multiple Logux instances on same web page.
   */
  constructor (name?: string)

  /**
   * Database name.
   */
  name: string
}
