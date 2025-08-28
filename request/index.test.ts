import { type AnyAction, TestPair, TestTime } from '@logux/core'
import { delay } from 'nanodelay'
import { expect, it } from 'vitest'

import { request, type RequestOptions } from '../index.js'

type Test = {
  answer: AnyAction | Error | undefined
  pair: TestPair
  response(answer: AnyAction): Promise<void>
}

async function createTest(
  action: AnyAction,
  opts: Partial<RequestOptions> = {}
): Promise<Test> {
  let test: Test = {
    answer: undefined,
    pair: new TestPair(),
    async response(answer) {
      test.pair.right.send(['synced', 1])
      test.pair.right.send(['sync', 2, answer, { id: 2, time: 2 }])
      await delay(15)
    }
  }
  let time = new TestTime()

  request(action, {
    server: test.pair.left,
    subprotocol: 10,
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

  return test
}

async function connectTest(
  action: AnyAction,
  opts: Partial<RequestOptions> = {}
): Promise<Test> {
  let test = await createTest(action, opts)
  await test.pair.wait()
  test.pair.right.send(['connected', 5, 'server:uuid', [0, 0]])
  await delay(15)
  return test
}

it('sends action to the server and wait for response', async () => {
  let test = await connectTest({ type: 'test' })
  await delay(1)
  expect(test.answer).toBeUndefined()
  expect(test.pair.leftSent).toEqual([
    ['connect', 5, 'anonymous:1:1', 0, { subprotocol: 10 }],
    ['sync', 1, { type: 'test' }, { id: 1, time: 1 }]
  ])

  await test.response({ type: 'response' })
  expect(test.answer).toEqual({ type: 'response' })
})

it('waits for logux/undo', async () => {
  let test = await connectTest({ type: 'test' }, { userId: '10' })

  expect(test.answer).toBeUndefined()
  expect(test.pair.leftSent).toEqual([
    ['connect', 5, '10:1:1', 0, { subprotocol: 10 }],
    ['sync', 1, { type: 'test' }, { id: 1, time: 1 }]
  ])

  await test.response({ id: '1 10:1:1 0', reason: 'test', type: 'logux/undo' })
  expect(test.answer?.message).toBe('Server undid action because of test')
})

it('throws Logux errors', async () => {
  let test = await createTest({ type: 'test ' })

  test.pair.right.send(['error', 'wrong-subprotocol', { supported: 20 }])
  await delay(20)

  expect(test.answer?.name).toBe('LoguxError')
  expect(test.answer?.message).toContain('Logux received wrong-subprotocol')
})
