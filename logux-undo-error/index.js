class LoguxUndoError extends Error {
  constructor (action) {
    let type = action.action ? action.action.type : 'action'
    super(`Server undid ${type} because of ${action.reason}`)
    this.name = 'LoguxUndoError'
    this.action = action
  }
}

module.exports = { LoguxUndoError }
