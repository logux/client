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

if (post.value.isLoading) {
  // THROWS Property 'title' does not exist
  post.value.title = 'New title'
} else {
  // THROWS Cannot assign to 'title' because it is a read-only
  post.value.title = 'New title'
}

let postListItem = postList.value.stores.get('10')!.value!
if (postListItem.isLoading) {
  // THROWS Property 'title' does not exist
  postListItem.title = 'New title'
} else {
  // THROWS Cannot assign to 'title' because it is a read-only
  postListItem.title = 'New title'
}

if (custom.value.isLoading) {
  // THROWS Property 'title' does not exist
  custom.value.title = 'B'
} else {
  // THROWS Cannot assign to 'title' because it is a read-only
  custom.value.title = 'B'
}
