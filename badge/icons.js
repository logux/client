var reloadIcon = require('./reload.svg')
var errorIcon = require('./error.svg')
var sendingIcon = require('./sending.svg')
var successIcon = require('./success.svg')
var disconnectedIcon = require('./disconnected.svg')

module.exports = {
  synchronized: successIcon,
  disconnected: disconnectedIcon,
  wait: disconnectedIcon,
  connecting: sendingIcon,
  sending: sendingIcon,
  error: errorIcon,
  protocolError: reloadIcon
}
