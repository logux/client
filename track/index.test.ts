import type { TestLog } from '@logux/core'

import { TestPair, TestTime } from '@logux/core'
import { it, expect } from 'vitest'
import { delay } from 'nanodelay'

import { Client, track } from '../index.js'

it('tracks action processing', async () => {
  let pair = new TestPair()
  let client = new Client<{}, TestLog>({
    subprotocol: '1.0.0',
    userId: '10',
    server: pair.left,
    time: new TestTime()
  })
  client.node.catch(() => {})

  let results: string[] = []

  client.type('A', async (action, meta) => {
    try {
      await track(client, meta.id)
      results.push('processed ' + meta.id)
    } catch (e) {
      if (e instanceof Error) results.push(e.message)
    }
  })

  let meta1 = await client.log.add({ type: 'A' })
  if (meta1 !== false) {
    await client.log.add({ type: 'logux/processed', id: meta1.id })
  }
  await delay(10)
  expect(results).toEqual(['processed 1 10:1:1 0'])

  results = []
  let meta2 = await client.log.add({ type: 'A' })
  if (meta2 !== false) {
    await client.log.add({ type: 'logux/undo', id: meta2.id, reason: 'test' })
  }
  await delay(10)
  expect(results).toEqual(['Server undid action because of test'])
})

it('works on multiple calls', async () => {
  let pair = new TestPair()
  let client = new Client<{}, TestLog>({
    subprotocol: '1.0.0',
    userId: '10',
    server: pair.left,
    time: new TestTime()
  })
  client.node.catch(() => {})

  let resolves: string[] = []

  let id = client.log.generateId()
  client.sync({ type: 'FOO' }, { id }).then(() => {
    resolves.push('sync')
  })
  track(client, id).then(() => {
    resolves.push('track1')
  })
  track(client, id).then(() => {
    resolves.push('track2')
  })

  await client.log.add({ type: 'logux/processed', id })
  await delay(10)
  expect(resolves).toEqual(['sync', 'track1', 'track2'])
})
