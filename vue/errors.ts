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

if (post.value.status === 'loading') {
  // THROWS Property 'value' does not exist
  post.value.value.title = 'New title'
} else {
  // THROWS Cannot assign to 'title' because it is a read-only
  post.value.value.title = 'New title'
}

if (postList.value.status === 'ready') {
  let postListItem = postList.value.stores.get('10')!.value!
  if (postListItem.status === 'loading') {
    // THROWS Property 'value' does not exist
    postListItem.value.title = 'New title'
  } else {
    // THROWS Cannot assign to 'title' because it is a read-only
    postListItem.value.title = 'New title'
  }
}

if (custom.value.status === 'loading') {
  // THROWS Property 'value' does not exist
  custom.value.value.title = 'B'
} else {
  // THROWS Cannot assign to 'title' because it is a read-only
  custom.value.value.title = 'B'
}
