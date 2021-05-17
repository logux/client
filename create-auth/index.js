import { createStore } from '@logux/state'

export function createAuth(client) {
  let auth = createStore(() => {
    auth.set({
      userId: client.options.userId,
      isAuthenticated: client.node.state === 'synchronized'
    })

    let stateBinded = false
    let unbindState

    let bindState = () => {
      stateBinded = true
      unbindState = client.node.on('state', () => {
        if (client.node.state === 'synchronized') {
          auth.set({ ...auth.value, isAuthenticated: true })
          unbindState()
          stateBinded = false
        }
      })
    }

    bindState()

    let unbindError = client.node.catch(error => {
      if (error.type === 'wrong-credentials') {
        !stateBinded && bindState()
        auth.set({ ...auth.value, isAuthenticated: false })
      }
    })
    let unbindUser = client.on('user', newUserId => {
      auth.set({ ...auth.value, userId: newUserId })
    })

    return () => {
      unbindState()
      unbindError()
      unbindUser()
    }
  })

  return auth
}
