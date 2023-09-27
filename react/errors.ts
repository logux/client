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

if (post.isLoading) {
  // THROWS Property 'title' does not exist
  post.title = 'New title'
}

if (!postList.isLoading) {
  let postListItem = postList.stores.get('10')!.value!
  if (postListItem.isLoading) {
    // THROWS Property 'title' does not exist
    postListItem.title = 'New title'
  }
}

if (custom.isLoading) {
  // THROWS Property 'title' does not exist
  custom.title = 'B'
}
