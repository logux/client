/**
 * Logger.
 *
 * @param {Syncable|BaseSync} sync Observed Sync instance.
 *
 * @return {Function} Unbind log listener.
 *
 * @example
 * import log from 'logux-status/log'
 * log(client)
 */
function log (sync) {
  if (sync.sync) sync = sync.sync

  var unbind = []

  unbind.push(sync.on('connect', function () {
    console.log('Logux Sync: connect')
  }))

  unbind.push(sync.on('state', function () {
    console.log('Logux Sync: state is ' + sync.state)
  }))

  unbind.push(sync.on('error', function (error) {
    console.log('Logux Sync: error ' + error.type)
  }))

  unbind.push(sync.on('clientError', function (error) {
    console.log('Logux Sync: clientError ' + error.type)
  }))

  unbind.push(sync.log.on('add', function (action) {
    console.log('Logux Sync Log: add action ' + action.type)
  }))

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
  }
}

module.exports = log
