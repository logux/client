import { map, type MapStore } from 'nanostores'

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

if (post.status === 'loading') {
  // THROWS Property 'value' does not exist
  post.value.title = 'New title'
}

if (postList.status === 'ready') {
  let postListItem = postList.stores.get('10')!.value!
  if (postListItem.status === 'loading') {
    // THROWS Property 'value' does not exist
    postListItem.value.title = 'New title'
  }
}

if (custom.status === 'loading') {
  // THROWS Property 'value' does not exist
  custom.value.title = 'B'
}
