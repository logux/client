import { map, onMount, startTask } from 'nanostores'
import { isFirstOlder } from '@logux/core'

import { track } from '../track/index.js'

export function createFilter(client, Template, filter = {}, opts = {}) {
  let id = Template.plural + JSON.stringify(filter) + JSON.stringify(opts)
  if (!Template.filters) Template.filters = {}

  if (!Template.filters[id]) {
    let filterStore = map()

    onMount(filterStore, () => {
      let listener
      if (opts.listChangesOnly) {
        listener = () => {}
      } else {
        listener = () => {
          filterStore.setKey(
            'list',
            Array.from(stores.values()).map(i => i.value)
          )
        }
      }

      let stores = new Map()
      filterStore.setKey('stores', stores)
      let isLoading = true
      filterStore.setKey('isLoading', true)
      filterStore.setKey('isEmpty', true)

      let list = []
      filterStore.setKey('list', list)

      let channelPrefix = Template.plural + '/'

      let createdType = `${Template.plural}/created`
      let createType = `${Template.plural}/create`
      let changedType = `${Template.plural}/changed`
      let changeType = `${Template.plural}/change`
      let deletedType = `${Template.plural}/deleted`
      let deleteType = `${Template.plural}/delete`
      let subscribe = {
        type: 'logux/subscribe',
        channel: Template.plural,
        filter
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
        filterStore.setKey(
          'list',
          Array.from(stores.values()).map(i => i.value)
        )
        filterStore.setKey('isEmpty', stores.size === 0)
      }

      function remove(childId) {
        subscribed.delete(channelPrefix + childId)
        if (stores.has(childId)) {
          unbindIds.get(childId)()
          unbindIds.delete(childId)
          stores.delete(childId)
          filterStore.setKey(
            'list',
            Array.from(stores.values()).map(i => i.value)
          )
          filterStore.setKey('isEmpty', stores.size === 0)
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
        async function loadAndCheck(child) {
          let clear = child.listen(() => {})
          if (child.value.isLoading) await child.loading
          if (checkAllFields(child.value)) {
            add(child)
          }
          clear()
        }

        for (let i in Template.cache) {
          loadAndCheck(Template.cache[i])
        }

        let load = true
        if (process.env.NODE_ENV !== 'production') {
          if (Template.mocked) {
            load = false
            filterStore.setKey('isLoading', false)
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
                      let check = async () => {
                        loadAndCheck(Template(action.id, client))
                      }
                      checking.push(check())
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
                  isLoading = false
                  filterStore.setKey('isLoading', false)
                  endTask()
                  resolve()
                } else if (Template.remote) {
                  const subscribeSinceLatest = latestMeta !== undefined
                      ? { ...subscribe, since: { id: latestMeta.id, time: latestMeta.time } }
                      : subscribe
                  await client
                    .sync(subscribeSinceLatest)
                    .then(() => {
                      if (isLoading) {
                        isLoading = false
                        if (filterStore.value) {
                          filterStore.setKey('isLoading', false)
                        }
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
              })
          }

          if (Template.remote && !Template.offline) {
            client
              .sync(subscribe)
              .then(() => {
                if (isLoading) {
                  isLoading = false
                  if (filterStore.value) {
                    filterStore.setKey('isLoading', false)
                  }
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
        }

        function setReason(action, meta) {
          if (checkAllFields(action.fields)) {
            meta.reasons.push(id)
          }
        }

        function createAt(childId) {
          return Template.cache[childId].createdAt
        }

        let removeAndListen = (childId, actionId) => {
          let child = Template(childId, client)
          let clear = child.listen(() => {})
          remove(childId)
          track(client, actionId)
            .catch(() => {
              add(child)
            })
            .finally(() => {
              clear()
            })
        }

        unbinds.push(
          client.type('logux/subscribed', action => {
            if (action.channel.startsWith(channelPrefix)) {
              subscribed.add(action.channel)
            }
          }),
          client.type(createdType, setReason, { event: 'preadd' }),
          client.type(createType, setReason, { event: 'preadd' }),
          client.type(createdType, async (action, meta) => {
            if (checkAllFields(action.fields)) {
              add(
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
                add(child)
                track(client, meta.id).catch(() => {
                  remove(action.id)
                })
              } catch {}
            }
          }),
          client.type(changedType, async action => {
            await Promise.resolve()
            if (stores.has(action.id)) {
              if (!checkAllFields(stores.get(action.id).value)) {
                remove(action.id)
              }
            } else if (checkSomeFields(action.fields)) {
              loadAndCheck(Template(action.id, client))
            }
          }),
          client.type(changeType, async (action, meta) => {
            await Promise.resolve()
            if (stores.has(action.id)) {
              if (!checkAllFields(stores.get(action.id).value)) {
                removeAndListen(action.id, meta.id)
              }
            } else if (checkSomeFields(action.fields)) {
              let child = Template(action.id, client)
              let clear = child.listen(() => {})
              if (child.value.isLoading) await child.loading
              if (checkAllFields(child.value)) {
                clear()
                add(child)
                track(client, meta.id).catch(async () => {
                  let unbind = child.listen(() => {
                    if (!checkAllFields(child.value)) {
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
                type: 'logux/unsubscribe',
                channel: Template.plural,
                filter
              },
              { sync: true }
            )
          }
        }
        client.log.removeReason(id)
        delete Template.filters[id]
      }
    })
    Template.filters[id] = filterStore
  }
  return Template.filters[id]
}
