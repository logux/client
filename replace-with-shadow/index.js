import { shadow } from '@logux/actions'

export async function replaceWithShadow(client, meta) {
  let shadowMeta = await client.log.add(shadow({ id: meta.id }), {
    indexes: meta.indexes,
    reasons: [...meta.reasons],
    time: meta.time
  })
  await client.log.changeMeta(meta.id, { reasons: [] })
  return shadowMeta
}
