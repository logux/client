import VueTesting from '@testing-library/vue'
import Vue from 'vue'

import '../test/set-production.js'
import { loguxPlugin, useSync, ChannelErrors } from './index.js'
import { defineSyncMap, TestClient } from '../index.js'

let { render, screen } = VueTesting
let { defineComponent, h, nextTick } = Vue

let Store = defineSyncMap('test')

let IdTest = defineComponent(() => {
  let store = useSync(Store, 'ID')
  return () => h('div', store.value.isLoading ? 'loading' : store.value.id)
})

async function getText(component) {
  let client = new TestClient('10')
  render(
    defineComponent(
      () => () => h('div', { 'data-testid': 'test' }, h(component))
    ),
    {
      global: {
        plugins: [[loguxPlugin, client]]
      }
    }
  )
  await nextTick()
  return screen.getByTestId('test').textContent
}

it('does not have ChannelErrors check in production mode', async () => {
  expect(
    await getText(
      defineComponent(
        () => () =>
          h(ChannelErrors, null, {
            default: () => h(IdTest)
          })
      )
    )
  ).toEqual('loading')
})
