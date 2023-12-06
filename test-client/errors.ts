import { TestClient } from '../index.js'

let client = new TestClient<{ locale: string }>('10')

interface PostRenameAction {
  type: 'post/rename'
  postId: string
}

// THROWS 'lang' does not exist in type '{ locale: string; }
client.node.setLocalHeaders({ lang: 'ru' })

client.server.resend<PostRenameAction>(
  // THROWS posts/rename"' is not assignable to parameter of type '"post/rename
  'posts/rename',
  action => `posts/${action.postId}`
)

client.server.resend<PostRenameAction>(
  'post/rename',
  // THROWS Property 'post' does not exist on type 'PostRenameAction'
  action => `posts/${action.post}`
)
