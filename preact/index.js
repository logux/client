import { useState, useContext, useEffect } from 'preact/hooks'
import { createContext, h, Component } from 'preact'
import { useStore } from '@logux/state/preact'
import { getValue } from '@logux/state'

import { createFilter } from '../create-filter/index.js'
import { createAuth } from '../create-auth/index.js'

export let ClientContext = /*#__PURE__*/ createContext()

let ErrorsContext = /*#__PURE__*/ createContext()

export function useClient() {
  return useContext(ClientContext)
}

function useSyncStore(store) {
  let [error, setError] = useState(null)
  let [, forceRender] = useState({})

  let value
  if (process.env.NODE_ENV === 'production') {
    value = getValue(store)
  } else {
    try {
      value = getValue(store)
    } catch (e) {
      if (e.message === 'Missed Logux client') {
        throw new Error('Wrap components in Logux <ClientContext.Provider>')
      } else {
        throw e
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    let errorProcessors = useContext(ErrorsContext) || {}
    if (
      !errorProcessors.Error &&
      (!errorProcessors.NotFound || !errorProcessors.AccessDenied)
    ) {
      throw new Error(
        'Wrap components in Logux ' +
          '<ChannelErrors NotFound={Page404} AccessDenied={Page403}>'
      )
    }
  }

  useEffect(() => {
    let batching
    let unbind = store.listen(() => {
      if (batching) return
      batching = 1
      setTimeout(() => {
        batching = undefined
        forceRender({})
      })
    })

    if (store.loading) {
      store.loading.catch(e => {
        setError(e)
      })
    }

    return unbind
  }, [store])

  if (error) throw error
  return value
}

export function useSync(Builder, id, ...builderArgs) {
  if (process.env.NODE_ENV !== 'production') {
    if (typeof Builder !== 'function') {
      throw new Error('Use useStore() from @logux/state/react for stores')
    }
  }

  let client = useClient()
  let store = Builder(id, client, ...builderArgs)

  return useSyncStore(store)
}

export function useFilter(Builer, filter = {}, opts = {}) {
  let client = useClient()
  let instance = createFilter(client, Builer, filter, opts)
  return useSyncStore(instance)
}

let ErrorsCheckerProvider = ({ children, ...props }) => {
  let prevErrors = useContext(ErrorsContext) || {}
  let errors = { ...props, ...prevErrors }
  return h(ErrorsContext.Provider, { value: errors }, children)
}

export class ChannelErrors extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    let error = this.state.error
    if (!error) {
      if (process.env.NODE_ENV === 'production') {
        return this.props.children
      } else {
        return h(ErrorsCheckerProvider, this.props)
      }
    } else if (
      error.name !== 'LoguxUndoError' &&
      error.name !== 'LoguxNotFoundError'
    ) {
      throw error
    } else if (
      (error.name === 'LoguxNotFoundError' ||
        error.action.reason === 'notFound') &&
      this.props.NotFound
    ) {
      return h(this.props.NotFound, { error })
    } else if (error.action.reason === 'denied' && this.props.AccessDenied) {
      return h(this.props.AccessDenied, { error })
    } else if (this.props.Error) {
      return h(this.props.Error, { error })
    } else {
      throw error
    }
  }
}

export function useAuth() {
  return useStore(createAuth(useClient()))
}
