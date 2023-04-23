import { createElement as h } from 'preact'
import { screen, render } from '@testing-library/preact'
import { it, expect } from 'vitest'

import '../test/set-production.js'
import { useSync, ClientContext, ChannelErrors } from './index.js'
import { syncMapTemplate, TestClient } from '../index.js'

let Store = syncMapTemplate('test')

let IdTest = () => {
  let value = useSync(Store, 'ID')
  return h('div', {}, value.isLoading ? 'loading' : value.id)
}

function getText(component) {
  let client = new TestClient('10')
  render(
    h(
      ClientContext.Provider,
      { value: client },
      h('div', { 'data-testid': 'test' }, component)
    )
  )
  return screen.getByTestId('test').textContent
}

it('does not have ChannelErrors check in production mode', async () => {
  expect(getText(h(ChannelErrors, {}, h(IdTest)))).toBe('loading')
})
