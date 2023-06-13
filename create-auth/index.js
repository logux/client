import { atom, onMount } from 'nanostores'

export function createAuth(client) {
  let auth = atom({
    isAuthenticated: client.node.state === 'synchronized',
    userId: client.options.userId
  })

  onMount(auth, () => {
    auth.set({
      isAuthenticated: client.node.state === 'synchronized',
      userId: client.options.userId
    })

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
          auth.set({
            isAuthenticated: true,
            userId: auth.value.userId
          })
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
        auth.set({
          isAuthenticated: false,
          userId: auth.value.userId
        })
        if (!loaded) load()
      }
    })
    let unbindUser = client.on('user', userId => {
      auth.set({
        isAuthenticated: auth.value.isAuthenticated,
        userId
      })
    })

    return () => {
      unbindState()
      unbindError()
      unbindUser()
    }
  })

  return auth
}
