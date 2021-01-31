export function track (client, id) {
  if (client.processing[id]) return client.processing[id][0]

  let resolveCallback, rejectCallback
  let promise = new Promise((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  client.processing[id] = [promise, resolveCallback, rejectCallback]

  return promise
}
