function favicon (client, links) {
  let normal = links.normal
  let offline = links.offline
  let error = links.error

  let unbind = []
  let doc = document
  let fav = false
  let prevFav = false

  function update () {
    if (client.connected && prevFav !== normal) {
      fav.href = prevFav = normal
    } else if (
      !client.connected && offline &&
      prevFav !== offline && prevFav !== error
    ) {
      fav.href = prevFav = offline
    }
  }

  function setError () {
    if (error && prevFav !== error) {
      fav.href = prevFav = error
    }
  }

  if (doc) {
    fav = doc.querySelector('link[rel~="icon"]')

    if (typeof normal === 'undefined') {
      normal = fav ? fav.href : ''
    }

    if (!fav) {
      fav = doc.createElement('link')
      fav.rel = 'icon'
      fav.href = ''
      doc.head.appendChild(fav)
    }

    unbind.push(client.on('state', update))
    update()

    unbind.push(client.on('add', action => {
      if (action.type === 'logux/undo' && action.reason) setError()
    }))

    unbind.push(client.node.on('error', err => {
      if (err.type !== 'timeout') setError()
    }))
  }

  return () => {
    for (let i of unbind) i()
  }
}

module.exports = { favicon }
