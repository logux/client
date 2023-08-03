import { registerStore, useStore } from '@nanostores/vue'
import {
  computed,
  getCurrentInstance,
  getCurrentScope,
  inject,
  onErrorCaptured,
  onScopeDispose,
  provide,
  reactive,
  readonly,
  ref,
  shallowRef,
  unref,
  watch
} from 'vue'

import { createAuth } from '../create-auth/index.js'
import { createFilter } from '../create-filter/index.js'

const createSymbol = name => {
  return process.env.NODE_ENV !== 'production' ? Symbol(name) : Symbol()
}

export const ClientKey = /*#__PURE__*/ createSymbol('logux-client')
export const ErrorsKey = /*#__PURE__*/ createSymbol('logux-errors')

export function loguxPlugin(app, client) {
  app.provide(ClientKey, client)
  app.config.globalProperties.$logux = client
}

export function useClient() {
  let client = inject(ClientKey)
  if (process.env.NODE_ENV !== 'production' && !client) {
    throw new Error(
      `Install Logux Client using loguxPlugin: ` +
        `app.use(loguxPlugin, client).`
    )
  }
  return client
}

function checkErrorProcessor() {
  let processor = getCurrentInstance() && inject(ErrorsKey, null)
  if (!processor) {
    throw new Error(
      'Wrap components in Logux <channel-errors v-slot="{ code, error }">'
    )
  }
}

function useSyncStore(store) {
  let error = shallowRef()
  let state = shallowRef()

  let unsubscribe = store.subscribe(value => {
    state.value = value
  })

  if (store.loading) {
    watch(error, () => {
      throw error.value
    })
    store.loading.catch(e => {
      error.value = e
    })
  }

  getCurrentScope() && onScopeDispose(() => {
    unsubscribe()
  })

  if (process.env.NODE_ENV !== 'production') {
    registerStore(store)
  }

  return [state, unsubscribe]
}

function syncRefs (source, target) {
  return watch(source, value => {
    target.value = value
  }, { deep: true, flush: 'sync', immediate: true })
}

export function useSync(Template, id, ...builderArgs) {
  if (process.env.NODE_ENV !== 'production') {
    if (typeof Template !== 'function') {
      throw new Error('Use useStore() from @nanostores/vue for stores')
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    checkErrorProcessor()
  }

  let client = useClient()
  let state = ref()
  let store
  let unwatch
  let unsubscribe

  watch(
    () => unref(id),
    newId => {
      if (unwatch) { unwatch() }
      if (unsubscribe) { unsubscribe() }

      [store, unsubscribe] = useSyncStore(
        Template(newId, client, ...builderArgs)
      )
      unwatch = syncRefs(store, state)
    },
    { immediate: true }
  )

  if (process.env.NODE_ENV !== 'production') {
    return readonly(state)
  }
  return state
}

export function useFilter(Template, filter = {}, opts = {}) {
  if (process.env.NODE_ENV !== 'production') {
    checkErrorProcessor()
  }

  let client = useClient()
  let state = ref()
  let store
  let unwatch
  let unsubscribe

  watch(
    () => [unref(filter), unref(opts)],
    ([newFilter, newOpts]) => {
      if (unwatch) { unwatch() }
      if (unsubscribe) { unsubscribe() }

      [store, unsubscribe] = useSyncStore(
        createFilter(client, Template, newFilter, newOpts)
      )
      unwatch = syncRefs(store, state)
    },
    { deep: true, immediate: true }
  )

  if (process.env.NODE_ENV !== 'production') {
    return readonly(state)
  }
  return state
}

export let ChannelErrors = {
  name: 'LoguxChannelErrors',
  setup(props, { slots }) {
    let error = shallowRef()
    let code = computed(() => {
      if (!error.value) {
        return undefined
      } else {
        let { action, name } = error.value.data
        if (name === 'LoguxNotFoundError' || action.reason === 'notFound') {
          return 404
        } else if (action.reason === 'denied') {
          return 403
        } else {
          return 500
        }
      }
    })

    if (process.env.NODE_ENV !== 'production') {
      provide(ErrorsKey, readonly(reactive({ code, error })))
    }

    onErrorCaptured((e, instance, info) => {
      if (e.name === 'LoguxUndoError' || e.name === 'LoguxNotFoundError') {
        error.value = { data: e, info, instance }
        return false
      }
      return undefined
    })

    return () => slots.default({ code, error }) || null
  }
}

export function useAuth(client) {
  let auth = useStore(createAuth(client || useClient()))
  return {
    isAuthenticated: computed(() => auth.value.isAuthenticated),
    userId: computed(() => auth.value.userId)
  }
}
