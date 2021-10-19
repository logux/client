import VueTesting from '@testing-library/vue'
import Vue from 'vue'

import '../test/set-production.js'
import { loguxPlugin, useSync, ChannelErrors, useFilter } from './index.js'
import { defineSyncMap, TestClient } from '../index.js'

let { defineComponent, h, isReadonly, nextTick } = Vue
let { render, screen } = VueTesting

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

it('does not return readonly state in production mode', () => {
  let client = new TestClient('10')
  render(
    defineComponent(() => {
      let state = useSync(Store, 'ID')
      let list = useFilter(Store)
      expect(isReadonly(state)).toBe(false)
      expect(isReadonly(list)).toBe(false)
      return () => null
    }),
    {
      global: {
        plugins: [[loguxPlugin, client]]
      }
    }
  )
})

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
  ).toBe('loading')
})
