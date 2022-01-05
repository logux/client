import { useStore, batch } from '@nanostores/react'
import React from 'react'

import { createFilter } from '../create-filter/index.js'
import { createAuth } from '../create-auth/index.js'

export let ClientContext = /*#__PURE__*/ React.createContext()

let ErrorsContext = /*#__PURE__*/ React.createContext()

let useIsomorphicLayoutEffect = typeof document !== 'undefined' ? React.useLayoutEffect : React.useEffect

export function useClient() {
  let client = React.useContext(ClientContext)
  if (process.env.NODE_ENV !== 'production' && !client) {
    throw new Error('Wrap components in Logux <ClientContext.Provider>')
  }
  return client
}

function useSyncStore(store) {
  let [error, setError] = React.useState(null)
  let [, forceRender] = React.useState({})
  let value = store.get()

  if (process.env.NODE_ENV !== 'production') {
    let errorProcessors = React.useContext(ErrorsContext) || {}
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

  useIsomorphicLayoutEffect(() => {
    let unbind = store.listen(() => {
      batch(() => {
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

export function useSync(Template, id, ...builderArgs) {
  if (process.env.NODE_ENV !== 'production') {
    if (typeof Template !== 'function') {
      throw new Error('Use useStore() from @nanostores/react for stores')
    }
  }

  let client = useClient()
  let store = Template(id, client, ...builderArgs)

  return useSyncStore(store)
}

export function useFilter(Builder, filter = {}, opts = {}) {
  let client = useClient()
  let instance = createFilter(client, Builder, filter, opts)
  return useSyncStore(instance)
}

let ErrorsCheckerProvider = ({ children, ...props }) => {
  let prevErrors = React.useContext(ErrorsContext) || {}
  let errors = { ...props, ...prevErrors }
  return React.createElement(
    ErrorsContext.Provider,
    { value: errors },
    children
  )
}

export class ChannelErrors extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    let error = this.state.error
    let h = React.createElement
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
    } else if (
      error.action &&
      error.action.reason === 'denied' &&
      this.props.AccessDenied
    ) {
      return h(this.props.AccessDenied, { error })
    } else if (this.props.Error) {
      return h(this.props.Error, { error })
    } else {
      throw error
    }
  }
}

export function useAuth() {
  let client = useClient()
  let authRef = React.useRef()
  if (!authRef.current) authRef.current = createAuth(client)
  return useStore(authRef.current)
}
