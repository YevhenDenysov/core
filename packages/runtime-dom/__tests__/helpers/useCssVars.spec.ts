import {
  render,
  useCSSVars,
  h,
  reactive,
  nextTick,
  ComponentOptions
} from '@vue/runtime-dom'

describe('useCssVars', () => {
  async function assertCssVars(
    getApp: (state: any) => ComponentOptions,
    scopeId?: string
  ) {
    const state = reactive({ color: 'red' })
    const App = getApp(state)
    const root = document.createElement('div')
    const prefix = scopeId ? `${scopeId}-` : ``

    render(h(App), root)
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--${prefix}color`))
    }

    state.color = 'green'
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--${prefix}color`))
    }
  }

  test('basic', async () => {
    await assertCssVars(state => ({
      setup() {
        // test receiving render context
        useCSSVars((ctx: any) => ({
          color: ctx.color
        }))
        return state
      },
      render() {
        return h('div')
      }
    }))
  })

  test('on fragment root', async () => {
    await assertCssVars(state => ({
      setup() {
        useCSSVars(() => state)
        return () => [h('div'), h('div')]
      }
    }))
  })

  test('on HOCs', async () => {
    const Child = () => [h('div'), h('div')]

    await assertCssVars(state => ({
      setup() {
        useCSSVars(() => state)
        return () => h(Child)
      }
    }))
  })

  test('with scopeId', async () => {
    const id = 'v-12345'

    await assertCssVars(
      state => ({
        setup() {
          useCSSVars(() => state, id)
          return () => h('div')
        }
      }),
      id
    )
  })
})
