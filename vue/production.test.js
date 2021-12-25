import VueTesting from '@testing-library/vue'
import Vue from 'vue'

import '../test/set-production.js'
import { loguxPlugin, useSync, ChannelErrors, useFilter } from './index.js'
import { syncMapTemplate, TestClient } from '../index.js'

let { defineComponent, h, isReadonly, nextTick, ref } = Vue
let { render, screen } = VueTesting

let Store = syncMapTemplate('test')

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
      expect(isReadonly(state)).toBe(false)

      let id = ref('ID')
      let stateWithReactiveId = useSync(Store, id)
      expect(isReadonly(stateWithReactiveId)).toBe(false)

      let list = useFilter(Store)
      expect(isReadonly(list)).toBe(false)

      let filter = ref({ projectId: 'ID' })
      let listWithReactiveFilter = useFilter(Store, filter)
      expect(isReadonly(listWithReactiveFilter)).toBe(false)

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
