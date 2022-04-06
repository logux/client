import { atom, onMount } from 'nanostores'

export function createClientStore(userIdStore, builder) {
  let clientStore = atom()

  let prevClient
  function destroyPrev() {
    if (prevClient) prevClient.destroy()
    prevClient = undefined
  }

  let prevUserId
  function listener(value) {
    if (prevUserId !== value.userId) {
      prevUserId = value.userId

      destroyPrev()
      let client
      if (value.userId) {
        client = builder(value)
        if (client) {
          prevClient = client
          client.start()
          clientStore.set(client)
        }
      }
      if (!client) {
        clientStore.set(undefined)
      }
    }
  }

  listener(userIdStore.get())
  onMount(clientStore, () => {
    let unbind = userIdStore.subscribe(listener)
    return () => {
      unbind()
      destroyPrev()
      clientStore.set(undefined)
    }
  })

  return clientStore
}
