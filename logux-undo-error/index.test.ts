import { expect, it } from 'vitest'

import { LoguxUndoError } from '../index.js'

function undo(reason: string): LoguxUndoError {
  return new LoguxUndoError({
    action: { channel: 'users/1', type: 'logux/subscribe' },
    id: '1 10:1:1 0',
    reason,
    type: 'logux/undo'
  })
}

it('checks undo error', () => {
  expect(LoguxUndoError.is(undo('notFound'))).toBe(true)
  expect(LoguxUndoError.is(new Error('notFound'))).toBe(false)
  expect(LoguxUndoError.is(undefined)).toBe(false)
  expect(LoguxUndoError.is(null, 'notFound')).toBe(false)
})

it('checks undo error reason', () => {
  expect(LoguxUndoError.is(undo('notFound'), 'notFound')).toBe(true)
  expect(LoguxUndoError.is(undo('denied'), 'notFound')).toBe(false)
})
