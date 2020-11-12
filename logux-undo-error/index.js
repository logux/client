class LoguxUndoError extends Error {
  constructor (action) {
    super('Server undid action because of ' + action.reason)
    this.name = 'LoguxUndoError'
    this.action = action
  }
}

module.exports = { LoguxUndoError }
