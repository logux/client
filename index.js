var CrossTabClient = require('./cross-tab-client')
var attention = require('./attention')
var confirm = require('./confirm')
var favicon = require('./favicon')
var Client = require('./client')
var status = require('./status')
var badge = require('./badge')
var log = require('./log')

module.exports = {
  CrossTabClient: CrossTabClient,
  attention: attention,
  confirm: confirm,
  favicon: favicon,
  Client: Client,
  status: status,
  badge: badge,
  log: log
}
