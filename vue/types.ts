import type { MapStore} from 'nanostores'
import { map } from 'nanostores'

import { syncMapTemplate } from '../sync-map-template/index.js'
import { useFilter, useSync } from './index.js'

type Post = {
  id: string
  title: string
}

let $post = syncMapTemplate<Post>('posts')

let post = useSync($post, '10')
let postList = useFilter($post, { id: '10' })

let $custom = (id: string): MapStore<Post> => map({ id, text: 'A' })
let custom = useSync($custom, '10')
let customList = useFilter($custom, { id: '10' })

console.log({ custom, customList, post, postList })
