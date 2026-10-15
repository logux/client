export class LoguxUndoError extends Error {
  static is(thrown, reason) {
    return (
      !!thrown &&
      thrown.name === 'LoguxUndoError' &&
      (!reason || thrown.action.reason === reason)
    )
  }

  constructor(action) {
    let type = action.action ? action.action.type : 'action'
    super(`Server undid ${type} because of ${action.reason}`)
    this.name = 'LoguxUndoError'
    this.action = action
  }
}

