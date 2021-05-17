import { createMap } from '@logux/state'

export function createAuth(client) {
  let auth = createMap(() => {
    auth.setKey('userId', client.options.userId)
    auth.setKey('isAuthenticated', client.node.state === 'synchronized')

    let stateBinded = false
    let unbindState

    let bindState = () => {
      stateBinded = true
      unbindState = client.node.on('state', () => {
        if (client.node.state === 'synchronized') {
          auth.setKey('isAuthenticated', true)
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
