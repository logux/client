import {
  getCurrentInstance,
  onBeforeUnmount,
  onErrorCaptured,
  triggerRef,
  reactive,
  readonly,
  computed,
  provide,
  inject,
  watch,
  isRef,
  toRef,
  ref
} from 'vue'
import { useStore } from 'nanostores/vue'

import { createFilter } from '../create-filter/index.js'
import { createAuth } from '../create-auth/index.js'

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
  return inject(ClientKey)
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
  let error = ref(null)
  let state = ref()
  let unsubscribe

  let listener = newState => {
    state.value = newState
    triggerRef(state)
  }

  if (process.env.NODE_ENV === 'production') {
    unsubscribe = store.subscribe(listener)
  } else {
    try {
      unsubscribe = store.subscribe(listener)
    } catch (e) {
      if (e.message === 'Missed Logux client') {
        throw new Error(
          `Install Logux Client using loguxPlugin: ` +
            `app.use(loguxPlugin, client).`
        )
      } else {
        throw e
      }
    }
  }

  if (store.loading) {
    watch(error, () => {
      throw error.value
    })
    store.loading.catch(e => {
      error.value = e
    })
  }

  getCurrentInstance() && onBeforeUnmount(unsubscribe)

  return state
}

export function useSync(Builder, id, ...builderArgs) {
  if (process.env.NODE_ENV !== 'production') {
    if (typeof Builder !== 'function') {
      throw new Error('Use useStore() from nanostores/vue for stores')
    }
  }

  if (typeof id === 'string') {
    id = ref(id)
  }

  if (process.env.NODE_ENV !== 'production') {
    checkErrorProcessor()
  }

  let client = useClient()
  let state = reactive({})

  watch(
    id,
    () => {
      state.value = useSyncStore(Builder(id.value, client, ...builderArgs))
    },
    { immediate: true }
  )

  if (process.env.NODE_ENV !== 'production') {
    return readonly(toRef(state, 'value'))
  }
  return toRef(state, 'value')
}

export function useFilter(Builder, filter = {}, opts = {}) {
  if (!isRef(filter)) filter = ref(filter)
  if (!isRef(opts)) opts = ref(opts)

  if (process.env.NODE_ENV !== 'production') {
    checkErrorProcessor()
  }

  let client = useClient()
  let state = reactive({})

  watch(
    [filter, opts],
    () => {
      state.value = useSyncStore(
        createFilter(client, Builder, filter.value, opts.value)
      )
    },
    { deep: true, immediate: true }
  )

  if (process.env.NODE_ENV !== 'production') {
    return readonly(toRef(state, 'value'))
  }
  return toRef(state, 'value')
}

export let ChannelErrors = {
  name: 'LoguxChannelErrors',
  setup(props, { slots }) {
    let error = ref(null)
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
        error.value = { data: e, instance, info }
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
    userId: computed(() => auth.value.userId),
    isAuthenticated: computed(() => auth.value.isAuthenticated)
  }
}
