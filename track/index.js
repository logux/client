function track (client, id) {
  return new Promise((resolve, reject) => {
    client.processing[id] = [resolve, reject]
  })
}

module.exports = { track }
