import { isFirstOlder } from '@logux/core'
import { clean, map, onMount, startTask, task } from 'nanostores'

import { LoguxUndoError } from '../logux-undo-error/index.js'
import { track } from '../track/index.js'

function changeIfLast(store, fields, meta) {
  let changes = {}
  for (let key in fields) {
    if (!meta || isFirstOlder(store.lastChanged[key], meta)) {
      changes[key] = fields[key]
      if (meta) store.lastChanged[key] = meta
    }
  }
  for (let key in changes) {
    store.setKey(key, changes[key])
  }
}

function getIndexes(plural, id) {
  return [plural, `${plural}/${id}`]
}

export function syncMapTemplate(plural, opts = {}) {
  let Template = (id, ...args) => {
    if (!Template.cache[id]) {
      Template.cache[id] = Template.build(id, ...args)
    }
    return Template.cache[id]
  }

  Template.cache = {}

  Template.build = (
    id,
    client,
    createAction,
    createMeta,
    alreadySubscribed
  ) => {
    let store = map({ id, isLoading: true })
    onMount(store, () => {
      if (!client) {
        throw new Error('Missed Logux client')
      }

      function saveProcessAndClean(fields, meta) {
        for (let key in fields) {
          if (isFirstOlder(store.lastProcessed[key], meta)) {
            store.lastProcessed[key] = meta
          }
          store.client.log.removeReason(`${store.plural}/${id}/${key}`, {
            olderThan: store.lastProcessed[key]
          })
        }
      }

      store.plural = plural
      store.client = client
      store.offline = Template.offline
      store.remote = Template.remote

      store.lastChanged = {}
      store.lastProcessed = {}

      let deletedType = `${plural}/deleted`
      let deleteType = `${plural}/delete`
      let createdType = `${plural}/created`
      let createType = `${plural}/create`
      let changeType = `${plural}/change`
      let changedType = `${plural}/changed`
      let subscribe = { channel: `${plural}/${id}`, type: 'logux/subscribe' }

      let loadingError
      let isLoading = true
      store.setKey('isLoading', true)

      if (createAction) {
        for (let key in createAction.fields) {
          store.setKey(key, createAction.fields[key])
          store.lastChanged[key] = createMeta
        }
        isLoading = false
        store.loading = Promise.resolve()
        store.setKey('isLoading', false)
        store.createdAt = createMeta
        if (
          createAction.type === createType ||
          createAction.type === changedType
        ) {
          track(client, createMeta.id)
            .then(() => {
              saveProcessAndClean(createAction.fields, createMeta)
            })
            .catch(() => {})
        }
        if (store.remote && !alreadySubscribed) {
          let action =
            createAction.type === createType
              ? { ...subscribe, creating: true }
              : subscribe
          client.log.add(action, { sync: true })
        }
      } else {
        let endTask = startTask()
        let loadingReject, loadingResolve
        store.loading = new Promise((resolve, reject) => {
          loadingResolve = () => {
            resolve()
            endTask()
          }
          loadingReject = e => {
            reject(e)
            endTask()
          }
        })

        async function processSubscribe(subscription) {
          await subscription
            .then(() => {
              if (isLoading) {
                isLoading = false
                store.setKey('isLoading', false)
                loadingResolve()
              }
            })
            .catch(e => {
              loadingError = true
              loadingReject(e)
            })
        }

        if (store.remote && !store.offline) {
          processSubscribe(client.sync(subscribe))
        }
        if (store.offline) {
          let found
          let latestMeta
          client.log
            .each({ index: `${plural}/${id}` }, (action, meta) => {
              let type = action.type
              if (action.id === id) {
                if (
                  type === changedType ||
                  type === changeType ||
                  type === createdType ||
                  type === createType
                ) {
                  if (latestMeta === undefined) {
                    latestMeta = meta
                  } else if (isFirstOlder(meta, latestMeta)) {
                    latestMeta = meta
                  }
                  changeIfLast(store, action.fields, meta)
                  found = true
                } else if (type === deletedType || type === deleteType) {
                  return false
                }
              }
              return undefined
            })
            .then(async () => {
              if (found && isLoading && !store.remote) {
                isLoading = false
                store.setKey('isLoading', false)
                loadingResolve()
              } else if (!found && !store.remote) {
                loadingReject(
                  new LoguxUndoError({
                    action: subscribe,
                    id: client.log.generateId(),
                    reason: 'notFound',
                    type: 'logux/undo'
                  })
                )
              } else if (store.remote) {
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
      }

      let reasonsForFields = (action, meta) => {
        for (let key in action.fields) {
          if (isFirstOlder(store.lastProcessed[key], meta)) {
            meta.reasons.push(`${plural}/${id}/${key}`)
          }
        }
      }

      let removeReasons = () => {
        for (let key in store.lastChanged) {
          client.log.removeReason(`${plural}/${id}/${key}`)
        }
      }

      let setFields = (action, meta) => {
        changeIfLast(store, action.fields, meta)
        saveProcessAndClean(action.fields, meta)
      }

      let setIndexes = (action, meta) => {
        meta.indexes = getIndexes(plural, action.id)
      }

      let unbinds = [
        client.type(changedType, setIndexes, { event: 'preadd', id }),
        client.type(changeType, setIndexes, { event: 'preadd', id }),
        client.type(deletedType, setIndexes, { event: 'preadd', id }),
        client.type(deleteType, setIndexes, { event: 'preadd', id }),
        client.type(createdType, reasonsForFields, { event: 'preadd', id }),
        client.type(changedType, reasonsForFields, { event: 'preadd', id }),
        client.type(changeType, reasonsForFields, { event: 'preadd', id }),
        client.type(
          deletedType,
          () => {
            store.deleted = true
            removeReasons()
          },
          { id }
        ),
        client.type(
          deleteType,
          async (action, meta) => {
            await task(async () => {
              try {
                await track(client, meta.id)
                store.deleted = true
                removeReasons()
              } catch {
                await client.log.changeMeta(meta.id, { reasons: [] })
              }
            })
          },
          { id }
        ),
        client.type(createdType, setFields, { id }),
        client.type(changedType, setFields, { id }),
        client.type(
          changeType,
          async (action, meta) => {
            let endTask = startTask()
            changeIfLast(store, action.fields, meta)
            try {
              await track(client, meta.id)
              saveProcessAndClean(action.fields, meta)
              if (store.offline) {
                client.log.add(
                  { ...action, type: changedType },
                  { time: meta.time }
                )
              }
              endTask()
            } catch {
              client.log.changeMeta(meta.id, { reasons: [] })
              let reverting = new Set(Object.keys(action.fields))
              client.log
                .each({ index: `${plural}/${id}` }, (a, m) => {
                  if (a.id === id && m.id !== meta.id) {
                    if (
                      (a.type === changeType ||
                        a.type === changedType ||
                        a.type === createType ||
                        a.type === createdType) &&
                      Object.keys(a.fields).some(i => reverting.has(i))
                    ) {
                      let revertDiff = {}
                      for (let key in a.fields) {
                        if (reverting.has(key)) {
                          delete store.lastChanged[key]
                          reverting.delete(key)
                          revertDiff[key] = a.fields[key]
                        }
                      }
                      changeIfLast(store, revertDiff, m)
                      return reverting.size === 0 ? false : undefined
                    } else if (
                      a.type === deleteType ||
                      a.type === deletedType
                    ) {
                      return false
                    }
                  }
                  return undefined
                })
                .then(() => {
                  for (let key of reverting) {
                    store.setKey(key, undefined)
                  }
                  endTask()
                })
            }
          },
          { id }
        )
      ]

      if (store.remote) {
        unbinds.push(() => {
          if (!loadingError) {
            client.log.add(
              { channel: subscribe.channel, type: 'logux/unsubscribe' },
              { sync: true }
            )
          }
        })
      }

      return () => {
        delete Template.cache[id]
        for (let i of unbinds) i()
        if (!store.offline) {
          for (let key in store.lastChanged) {
            client.log.removeReason(`${plural}/${id}/${key}`)
          }
        }
      }
    })
    return store
  }

  Template.plural = plural
  Template.offline = !!opts.offline
  Template.remote = opts.remote !== false

  if (process.env.NODE_ENV !== 'production') {
    Template[clean] = () => {
      for (let id in Template.cache) {
        Template.cache[id][clean]()
      }
      Template.cache = {}
      if (Template.filters) {
        for (let id in Template.filters) {
          Template.filters[id][clean]()
        }
        Template.filters = {}
      }
    }
  }

  return Template
}

function addSyncAction(client, Template, action, meta = {}) {
  meta.indexes = getIndexes(Template.plural, action.id)
  if (Template.remote) {
    return task(() => client.sync(action, meta))
  } else {
    return task(() => client.log.add(action, meta))
  }
}

export function createSyncMap(client, Template, value) {
  let { id, ...fields } = value
  if (Template.remote) {
    return addSyncAction(client, Template, {
      fields,
      id,
      type: `${Template.plural}/create`
    })
  } else {
    return addSyncAction(
      client,
      Template,
      {
        fields,
        id,
        type: `${Template.plural}/created`
      },
      {
        reasons: Object.keys(fields).map(i => `${Template.plural}/${id}/${i}`)
      }
    )
  }
}

export async function buildNewSyncMap(client, Template, value) {
  let { id, ...fields } = value
  let actionId = client.log.generateId()

  let verb = Template.remote ? 'create' : 'created'
  let type = `${Template.plural}/${verb}`
  let action = { fields, id, type }
  let meta = {
    id: actionId,
    indexes: getIndexes(Template.plural, id),
    time: parseInt(actionId)
  }
  if (Template.remote) {
    meta.sync = true
  } else {
    meta.reasons = Object.keys(fields).map(i => `${Template.plural}/${id}/${i}`)
  }
  await task(() => client.log.add(action, meta))

  let store = Template(id, client, action, meta)
  return store
}

export async function changeSyncMapById(client, Template, id, fields, value) {
  if (value) fields = { [fields]: value }

  if (Template.remote) {
    return addSyncAction(client, Template, {
      fields,
      id,
      type: `${Template.plural}/change`
    })
  } else {
    let reasons = Object.keys(fields).map(i => `${Template.plural}/${id}/${i}`)
    let meta = await addSyncAction(
      client,
      Template,
      {
        fields,
        id,
        type: `${Template.plural}/changed`
      },
      { reasons: [...reasons] }
    )
    return Promise.all(
      reasons.map(reason => {
        return client.log.removeReason(reason, { olderThan: meta })
      })
    )
  }
}

export function changeSyncMap(store, fields, value) {
  if (value) fields = { [fields]: value }
  changeIfLast(store, fields)
  return changeSyncMapById(store.client, store, store.get().id, fields)
}

export async function deleteSyncMapById(client, Template, id) {
  if (Template.remote) {
    return addSyncAction(client, Template, {
      id,
      type: `${Template.plural}/delete`
    })
  } else {
    let store = Template.client ? Template : Template(id, client)
    if (store.get().isLoading) await store.loading
    await Promise.all(
      Object.keys(store.get())
        .filter(i => i !== 'id' && i !== 'isLoading')
        .map(key => client.log.removeReason(`${Template.plural}/${id}/${key}`))
    )
    return addSyncAction(client, Template, {
      id,
      type: `${Template.plural}/deleted`
    })
  }
}

export function deleteSyncMap(store) {
  return deleteSyncMapById(store.client, store, store.get().id)
}

export function ensureLoaded(value) {
  if (value.isLoading) throw new Error('Store was not loaded yet')
  return value
}

export function ensureLoadedStore(store) {
  ensureLoaded(store.get())
  return store
}

export async function loadValue(store) {
  let value = store.get()
  if (value.isLoading) {
    let unbind = store.listen(() => {})
    try {
      await store.loading
    } catch (e) {
      if (e.name === 'LoguxUndoError' && e.action.reason === 'notFound') {
        return undefined
      } else {
        /* v8 ignore next 2 -- @preserve */
        throw e
      }
    } finally {
      unbind()
    }
    return store.get()
  } else {
    return value
  }
}
