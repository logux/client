/**
 * Logux confirm close tab if unsent actions in the logs synchronization.
 *
 * @param {Syncable|BaseSync} sync Observed Sync instance.
 * @param {String} warning The text of the warning.
 *
 * @return {Function} Unbind confirm listener.
 *
 * @example
 * import confirm from 'logux-status/confirm'
 * confirm(client, 'Do not close browser')
 */
function confirm (sync, warning) {
  if (sync.sync) sync = sync.sync

  warning = warning || 'Not all data was synchronized! ' +
                       'You will lost the changes if you leave the page!'

  var unbind = []

  unbind.push(sync.on('state', function () {
    if (typeof window.onbeforeunload !== 'undefined') {
      if (sync.state === 'wait') {
        window.onbeforeunload = function (e) {
          if (typeof e === 'undefined') e = window.event
          if (e) {
            e.returnValue = warning
          }
          return warning
        }
      }
    }
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = confirm
