/**
 * Change favicon to show Logux synchronization status.
 *
 * @param {Client} client Observed Client instance.
 * @param {object} [links] Set favicon links.
 * @param {string} [links.normal] Default favicon link.
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

  if (typeof doc !== 'undefined') {
    fav = doc.querySelector('link[rel~="icon"]')

    if (!fav) {
      fav = document.createElement('link')
      fav.rel = 'icon'
      fav.href = ''
      document.head.appendChild(fav)
    }

    unbind.push(client.on('state', function () {
      if (client.connected && normal && prevFav !== normal) {
        fav.href = prevFav = normal
      } else if (!client.connected && offline &&
                 prevFav !== offline && prevFav !== error) {
        fav.href = prevFav = offline
      }
    }))

    unbind.push(client.sync.on('error', function (err) {
      if (err.type !== 'timeout' && error && prevFav !== error) {
        fav.href = prevFav = error
      }
    }))
  }

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = favicon
