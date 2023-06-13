import { render, screen } from '@testing-library/react'
import { createElement as h } from 'react'
import { expect, it } from 'vitest'

// eslint-disable-next-line perfectionist/sort-imports
import '../test/set-production.js'

import { syncMapTemplate, TestClient } from '../index.js'
import { ChannelErrors, ClientContext, useSync } from './index.js'

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
