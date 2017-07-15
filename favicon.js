/**
 * Change favicon to show Logux synchronization status.
 *
 * @param {CrossTabClient} client Observed Client instance.
 * @param {object} [links] Set favicon links.
 * @param {string} [links.normal] Default favicon link. By default,
 *                                it will be taken from current favicon.
 * @param {string} [links.offline] Offline favicon link.
 * @param {string} [links.error] Error favicon link.
 *
 * @return {Function} Unbind favicon listener.
 *
 * @example
 * import favicon from 'logux-status/favicon'
 * favicon(client, {
 *   normal: '/favicon.ico',
 *   offline: '/offline.ico',
 *   error: '/error.ico'
 * })
 */
function favicon (client, links) {
  links = links || {}

  var normal = links.normal
  var offline = links.offline
  var error = links.error

  var unbind = []
  var doc = document
  var fav = false
  var prevFav = false

  function update () {
    if (client.connected && prevFav !== normal) {
      fav.href = prevFav = normal
    } else if (!client.connected && offline &&
               prevFav !== offline && prevFav !== error) {
      fav.href = prevFav = offline
    }
  }

  function setError () {
    if (error && prevFav !== error) {
      fav.href = prevFav = error
    }
  }

  if (typeof doc !== 'undefined') {
    fav = doc.querySelector('link[rel~="icon"]')

    if (typeof normal === 'undefined') {
      if (fav) {
        normal = fav.href
      } else {
        normal = ''
      }
    }

    if (!fav) {
      fav = document.createElement('link')
      fav.rel = 'icon'
      fav.href = ''
      document.head.appendChild(fav)
    }

    unbind.push(client.on('state', update))
    update()

    unbind.push(client.log.on('add', function (action) {
      if (action.type === 'logux/undo' && action.reason) setError()
    }))

    unbind.push(client.sync.on('error', function (err) {
      if (err.type !== 'timeout') setError()
    }))
  }

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = favicon
