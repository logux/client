import { TestPair, TestTime, AnyAction } from '@logux/core'
import { delay } from 'nanodelay'

import { request, RequestOptions } from '../index.js'

type Test = {
  pair: TestPair
  answer: AnyAction | Error | undefined
  response(answer: AnyAction): Promise<void>
}

async function createTest (
  action: AnyAction,
  opts: Partial<RequestOptions> = {}
) {
  let test: Test = {
    pair: new TestPair(),
    answer: undefined,
    async response (answer) {
      test.pair.right.send(['synced', 1])
      test.pair.right.send(['sync', 2, answer, { id: 2, time: 2 }])
      await delay(15)
    }
  }
  let time = new TestTime()

  request(action, {
    server: test.pair.left,
    subprotocol: '1.0.0',
    time,
    ...opts
  })
    .then(answer => {
      test.answer = answer
    })
    .catch(e => {
      test.answer = e
    })
  await test.pair.wait()
  test.pair.right.send(['connected', 4, 'server:uuid', [0, 0]])
  await delay(15)

  return test
}

it('sends action to the server and wait for response', async () => {
  let test = await createTest({ type: 'test' })
  expect(test.answer).toBeUndefined()
  expect(test.pair.leftSent).toEqual([
    ['connect', 4, 'anonymous:1:1', 0, { subprotocol: '1.0.0' }],
    ['sync', 1, { type: 'test' }, { id: 1, time: 1 }]
  ])

  await test.response({ type: 'response' })
  expect(test.answer).toEqual({ type: 'response' })
})

it('waits for logux/undo', async () => {
  let test = await createTest({ type: 'test' }, { userId: '10' })

  expect(test.answer).toBeUndefined()
  expect(test.pair.leftSent).toEqual([
    ['connect', 4, '10:1:1', 0, { subprotocol: '1.0.0' }],
    ['sync', 1, { type: 'test' }, { id: 1, time: 1 }]
  ])

  await test.response({ type: 'logux/undo', id: '1 10:1:1 0', reason: 'test' })
  expect(test.answer?.message).toEqual('Server undid action because of test')
})
