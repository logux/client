import { TestClient } from '../index.js'

let client = new TestClient<{ locale: string }>('10')

interface PostRenameAction {
  type: 'post/rename'
  postId: string
}

client.node.setLocalHeaders({ locale: 'ru' })

client.server.resend<PostRenameAction>(
  'post/rename',
  action => `posts/${action.postId}`
)
