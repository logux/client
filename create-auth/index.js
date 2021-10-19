import { atom, onMount } from 'nanostores'

export function createAuth(client) {
  let auth = atom({
    userId: client.options.userId,
    isAuthenticated: client.node.state === 'synchronized'
  })

  onMount(auth, () => {
    auth.set({
      userId: client.options.userId,
      isAuthenticated: client.node.state === 'synchronized'
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
            userId: auth.value.userId,
            isAuthenticated: true
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
          userId: auth.value.userId,
          isAuthenticated: false
        })
        if (!loaded) load()
      }
    })
    let unbindUser = client.on('user', userId => {
      auth.set({
        userId,
        isAuthenticated: auth.value.isAuthenticated
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
