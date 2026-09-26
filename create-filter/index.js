import { isFirstOlder } from '@logux/core'
import { map, onMount, startTask } from 'nanostores'

import { clientPrefix } from '../sync-map-template/index.js'
import { track } from '../track/index.js'

export function createFilter(client, Template, filter = {}, opts = {}) {
  let prefix = clientPrefix(client)
  let id = Template.plural + JSON.stringify(filter) + JSON.stringify(opts)
  let cacheKey = prefix + id
  if (!Template.filters) Template.filters = {}

  if (!Template.filters[cacheKey]) {
    let filterStore = map()

    onMount(filterStore, () => {
      let listener
      if (opts.listChangesOnly) {
        listener = () => {}
      } else {
        listener = () => {
          publish()
        }
      }

      let stores = new Map()
      let isLoading = true
      filterStore.set({ status: 'loading' })

      // The list is published only when the filter is ready, so the loading
      // value stays `{ status: 'loading' }` without a half-loaded list
      function publish() {
        if (isLoading) return
        filterStore.set({
          isEmpty: stores.size === 0,
          status: 'ready',
          stores,
          value: Array.from(stores.values()).map(i => i.value)
        })
      }

      function becomeReady() {
        isLoading = false
        publish()
      }

      function childFields(child) {
        return child.value.value
      }

      let channelPrefix = Template.plural + '/'

      let createdType = `${Template.plural}/created`
      let createType = `${Template.plural}/create`
      let changedType = `${Template.plural}/changed`
      let changeType = `${Template.plural}/change`
      let deletedType = `${Template.plural}/deleted`
      let deleteType = `${Template.plural}/delete`
      let subscribe = {
        channel: Template.plural,
        filter,
        type: 'logux/subscribe'
      }

      let unbinds = []
      let unbindIds = new Map()
      let subscribed = new Set()

      async function add(child) {
        let unbindChild = child.listen(listener)
        if (stores.has(child.value.id)) {
          unbindChild()
          return
        }
        unbindIds.set(child.value.id, unbindChild)
        stores.set(child.value.id, child)
        publish()
      }

      function remove(childId) {
        subscribed.delete(channelPrefix + childId)
        if (stores.has(childId)) {
          unbindIds.get(childId)()
          unbindIds.delete(childId)
          stores.delete(childId)
          publish()
        }
      }

      function checkSomeFields(fields) {
        let some = Object.keys(filter).length === 0
        for (let key in filter) {
          if (key in fields) {
            if (fields[key] === filter[key]) {
              some = true
            } else {
              return false
            }
          }
        }
        return some
      }

      function checkAllFields(fields) {
        for (let key in filter) {
          if (fields[key] !== filter[key]) {
            return false
          }
        }
        return true
      }

      let subscriptionError

      let endTask = startTask()
      filterStore.loading = new Promise((resolve, reject) => {
        async function processSubscribe(subscription) {
          await subscription
            .then(() => {
              if (isLoading) {
                isLoading = false
                // The store could be unmounted while the subscription loaded
                if (filterStore.value) publish()
                endTask()
                resolve()
              }
            })
            .catch(e => {
              subscriptionError = true
              reject(e)
              endTask()
            })
        }

        async function loadAndCheck(child) {
          let clear = child.listen(() => {})
          try {
            if (child.value.status === 'loading') await child.loading
            if (checkAllFields(childFields(child))) {
              await add(child)
            }
          } finally {
            clear()
          }
        }

        for (let i in Template.cache) {
          if (i.startsWith(prefix)) void loadAndCheck(Template.cache[i])
        }

        let load = true
        if (process.env.NODE_ENV !== 'production') {
          if (Template.mocked) {
            load = false
            becomeReady()
            endTask()
            resolve()
          }
        }

        if (load) {
          let ignore = new Set()
          let checking = []
          if (Template.offline) {
            let latestMeta
            client.log
              .each({ index: Template.plural }, async (action, meta) => {
                if (latestMeta === undefined) {
                  latestMeta = meta
                } else if (isFirstOlder(meta, latestMeta)) {
                  latestMeta = meta
                }

                if (action.id && !ignore.has(action.id)) {
                  let type = action.type
                  if (
                    type === createdType ||
                    type === createType ||
                    type === changedType ||
                    type === changeType
                  ) {
                    if (checkSomeFields(action.fields)) {
                      checking.push(loadAndCheck(Template(action.id, client)))
                      ignore.add(action.id)
                    }
                  } else if (type === deletedType || type === deleteType) {
                    ignore.add(action.id)
                  }
                }
              })
              .then(async () => {
                await Promise.all(checking)

                if (!Template.remote && isLoading) {
                  becomeReady()
                  endTask()
                  resolve()
                } else if (Template.remote) {
                  let subscribeSinceLatest =
                    latestMeta !== undefined
                      ? {
                          ...subscribe,
                          since: { id: latestMeta.id, time: latestMeta.time }
                        }
                      : subscribe
                  await processSubscribe(client.sync(subscribeSinceLatest))
                }
              })
          }

          if (Template.remote && !Template.offline) {
            void processSubscribe(client.sync(subscribe))
          }
        }

        function setReason(action, meta) {
          if (checkAllFields(action.fields)) {
            meta.reasons.push(id)
          }
        }

        function createAt(childId) {
          return Template.cache[prefix + childId].createdAt
        }

        let removeAndListen = (childId, actionId) => {
          remove(childId)
          if (Template.remote) {
            let child = Template(childId, client)
            let clear = child.listen(() => {})
            track(client, actionId)
              .catch(() => {
                return add(child)
              })
              .finally(() => {
                clear()
              })
          }
        }

        if (Template.remote) {
          unbinds.push(
            client.type(createdType, setReason, { event: 'preadd' }),
            client.type(createType, setReason, { event: 'preadd' })
          )
        }

        unbinds.push(
          client.type('logux/subscribed', action => {
            if (action.channel.startsWith(channelPrefix)) {
              subscribed.add(action.channel)
            }
          }),
          client.type(createdType, async (action, meta) => {
            if (checkAllFields(action.fields)) {
              await add(
                Template(
                  action.id,
                  client,
                  action,
                  meta,
                  subscribed.has(channelPrefix + action.id)
                )
              )
            }
          }),
          client.type(createType, async (action, meta) => {
            if (checkAllFields(action.fields)) {
              let child = Template(action.id, client, action, meta)
              try {
                await add(child)
                track(client, meta.id).catch(() => {
                  remove(action.id)
                })
              } catch {}
            }
          }),
          client.type(changedType, async (action, meta) => {
            await Promise.resolve()
            if (stores.has(action.id)) {
              if (!checkAllFields(childFields(stores.get(action.id)))) {
                remove(action.id)
              }
            } else if (checkSomeFields(action.fields)) {
              await loadAndCheck(
                Template(
                  action.id,
                  client,
                  action,
                  meta,
                  subscribed.has(channelPrefix + action.id)
                )
              )
            }
          }),
          client.type(changeType, async (action, meta) => {
            await Promise.resolve()
            if (stores.has(action.id)) {
              if (!checkAllFields(childFields(stores.get(action.id)))) {
                removeAndListen(action.id, meta.id)
              }
            } else if (checkSomeFields(action.fields)) {
              let child = Template(action.id, client)
              let clear = child.listen(() => {})
              try {
                if (child.value.status === 'loading') await child.loading
              } catch {
                /* v8 ignore next 2 -- @preserve */
                return
              }
              if (checkAllFields(childFields(child))) {
                clear()
                void add(child)
                track(client, meta.id).catch(async () => {
                  let unbind = child.listen(() => {
                    if (!checkAllFields(childFields(child))) {
                      remove(action.id)
                    }
                    unbind()
                  })
                })
              }
            }
          }),
          client.type(deletedType, (action, meta) => {
            if (
              stores.has(action.id) &&
              isFirstOlder(createAt(action.id), meta)
            ) {
              remove(action.id)
            }
          }),
          client.type(deleteType, (action, meta) => {
            if (
              stores.has(action.id) &&
              isFirstOlder(createAt(action.id), meta)
            ) {
              removeAndListen(action.id, meta.id)
            }
          })
        )
      })

      return () => {
        for (let unbind of unbinds) unbind()
        for (let unbindChild of unbindIds.values()) unbindChild()
        if (Template.remote) {
          if (!subscriptionError) {
            client.log.add(
              {
                channel: Template.plural,
                filter,
                type: 'logux/unsubscribe'
              },
              { sync: true }
            )
          }
        }
        client.log.removeReason(id)
        delete Template.filters[cacheKey]
      }
    })
    Template.filters[cacheKey] = filterStore
  }
  return Template.filters[cacheKey]
}
