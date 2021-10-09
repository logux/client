import { createMap } from 'nanostores'

export function createAuth(client) {
  let auth = createMap(() => {
    auth.setKey('userId', client.options.userId)
    auth.setKey('isAuthenticated', client.node.state === 'synchronized')

    let load
    let loaded = auth.value.isAuthenticated
    auth.loading = new Promise(resolve => {
      if (loaded) resolve()
      load = () => {
        loaded = true
        resolve()
      }
    })

    let stateBinded = false
    let unbindState

    let bindState = () => {
      stateBinded = true
      unbindState = client.node.on('state', () => {
        if (client.node.state === 'synchronized') {
          auth.setKey('isAuthenticated', true)
          if (!loaded) load()
          unbindState()
          stateBinded = false
        }
      })
    }

    bindState()

    let unbindError = client.node.catch(error => {
      if (error.type === 'wrong-credentials') {
        if (!stateBinded) bindState()
        auth.setKey('isAuthenticated', false)
        if (!loaded) load()
      }
    })
    let unbindUser = client.on('user', newUserId => {
      auth.setKey('userId', newUserId)
    })

    return () => {
      unbindState()
      unbindError()
      unbindUser()
    }
  })

  return auth
}
