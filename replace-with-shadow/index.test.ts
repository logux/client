import { shadow } from '@logux/actions'
import type { Action } from '@logux/core'
import { expect, it } from 'vitest'

import { type ClientMeta, replaceWithShadow, TestClient } from '../index.js'

it('replaces action body with shadow', async () => {
  let client = new TestClient('10')
  let cleaned: Action[] = []
  client.log.on('clean', action => {
    cleaned.push(action)
  })

  let meta = (await client.log.add(
    { fields: { name: 'A', url: 'B' }, id: 'F1', type: 'feeds/created' },
    {
      indexes: ['feeds', 'feeds/F1'],
      reasons: ['feeds/F1/name', 'feeds/F1/url']
    }
  )) as ClientMeta
  let shadowMeta = await replaceWithShadow(client, meta)

  expect(client.log.entries()).toEqual([
    [
      { id: meta.id, type: 'shadow' },
      {
        added: 2,
        id: shadowMeta.id,
        indexes: ['feeds', 'feeds/F1'],
        reasons: ['feeds/F1/name', 'feeds/F1/url'],
        subprotocol: 0,
        time: meta.time
      }
    ]
  ])
  expect(shadow.match(client.log.entries()[0]![0])).toBe(true)
  expect(cleaned).toEqual([
    { fields: { name: 'A', url: 'B' }, id: 'F1', type: 'feeds/created' }
  ])

  let found: Action[] = []
  await client.log.each({ index: 'feeds/F1' }, action => {
    found.push(action)
  })
  expect(found).toEqual([{ id: meta.id, type: 'shadow' }])
})

it('cleans shadow with the original ID after the last reason', async () => {
  let client = new TestClient('10')
  let cleaned: Action[] = []
  client.log.on('clean', action => {
    cleaned.push(action)
  })

  let meta = (await client.log.add(
    { fields: { name: 'A', url: 'B' }, id: 'F1', type: 'feeds/created' },
    {
      indexes: ['feeds', 'feeds/F1'],
      reasons: ['feeds/F1/name', 'feeds/F1/url']
    }
  )) as ClientMeta
  await replaceWithShadow(client, meta)

  await client.log.removeReason('feeds/F1/name')
  expect(client.log.entries()).toHaveLength(1)

  await client.log.removeReason('feeds/F1/url')
  expect(client.log.entries()).toHaveLength(0)
  expect(cleaned[1]).toEqual({ id: meta.id, type: 'shadow' })
})

it('does not send shadow to the server', async () => {
  let client = new TestClient('10')
  await client.connect()

  let meta = (await client.log.add(
    { fields: { name: 'A', url: 'B' }, id: 'F1', type: 'feeds/created' },
    { indexes: ['feeds', 'feeds/F1'], reasons: ['feeds/F1/name'] }
  )) as ClientMeta
  expect(
    await client.sent(async () => {
      await replaceWithShadow(client, meta)
    })
  ).toEqual([])
})
