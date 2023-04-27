let lastId = 0

export function emptyInTest(Template) {
  if (!Template.mocks) Template.mocked = true
}

export function prepareForTest(client, Template, value) {
  if (!Template.mocks) Template.mocked = true

  let { id, ...keys } = value
  if (!id) {
    if (Template.plural) {
      id = `${Template.plural}:${Object.keys(Template.cache).length + 1}`
    } else {
      id = `${++lastId}`
    }
  }

  let store = Template(id, client)
  store.listen(() => {})

  if ('isLoading' in store.value) {
    store.setKey('isLoading', false)
  }
  for (let key in keys) {
    store.setKey(key, keys[key])
  }

  return store
}
