import {
  compile,
  NodeTypes,
  CREATE_STATIC,
  createSimpleExpression
} from '../../src'
import {
  stringifyStatic,
  StringifyThresholds
} from '../../src/transforms/stringifyStatic'

describe('stringify static html', () => {
  function compileWithStringify(template: string) {
    return compile(template, {
      hoistStatic: true,
      prefixIdentifiers: true,
      transformHoist: stringifyStatic
    })
  }

  function repeat(code: string, n: number): string {
    return new Array(n)
      .fill(0)
      .map(() => code)
      .join('')
  }

  test('should bail on non-eligible static trees', () => {
    const { ast } = compileWithStringify(
      `<div><div><div>hello</div><div>hello</div></div></div>`
    )
    expect(ast.hoists.length).toBe(1)
    // should be a normal vnode call
    expect(ast.hoists[0].type).toBe(NodeTypes.VNODE_CALL)
  })

  test('should work on eligible content (elements with binding > 5)', () => {
    const { ast } = compileWithStringify(
      `<div><div>${repeat(
        `<span class="foo"/>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
      )}</div></div>`
    )
    expect(ast.hoists.length).toBe(1)
    // should be optimized now
    expect(ast.hoists[0]).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: CREATE_STATIC,
      arguments: [
        JSON.stringify(
          `<div>${repeat(
            `<span class="foo"></span>`,
            StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
          )}</div>`
        )
      ]
    })
  })

  test('should work on eligible content (elements > 20)', () => {
    const { ast } = compileWithStringify(
      `<div><div>${repeat(
        `<span/>`,
        StringifyThresholds.NODE_COUNT
      )}</div></div>`
    )
    expect(ast.hoists.length).toBe(1)
    // should be optimized now
    expect(ast.hoists[0]).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: CREATE_STATIC,
      arguments: [
        JSON.stringify(
          `<div>${repeat(
            `<span></span>`,
            StringifyThresholds.NODE_COUNT
          )}</div>`
        )
      ]
    })
  })

  test('serializing constant bindings', () => {
    const { ast } = compileWithStringify(
      `<div><div :style="{ color: 'red' }">${repeat(
        `<span :class="[{ foo: true }, { bar: true }]">{{ 1 }} + {{ false }}</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
      )}</div></div>`
    )
    expect(ast.hoists.length).toBe(1)
    // should be optimized now
    expect(ast.hoists[0]).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: CREATE_STATIC,
      arguments: [
        JSON.stringify(
          `<div style="color:red;">${repeat(
            `<span class="foo bar">1 + false</span>`,
            StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
          )}</div>`
        )
      ]
    })
  })

  test('escape', () => {
    const { ast } = compileWithStringify(
      `<div><div>${repeat(
        `<span :class="'foo' + '&gt;ar'">{{ 1 }} + {{ '<' }}</span>` +
          `<span>&amp;</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
      )}</div></div>`
    )
    expect(ast.hoists.length).toBe(1)
    // should be optimized now
    expect(ast.hoists[0]).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: CREATE_STATIC,
      arguments: [
        JSON.stringify(
          `<div>${repeat(
            `<span class="foo&gt;ar">1 + &lt;</span>` + `<span>&amp;</span>`,
            StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
          )}</div>`
        )
      ]
    })
  })

  test('should bail on runtime constant v-bind bindings', () => {
    const { ast } = compile(
      `<div><div><img src="./foo" />${repeat(
        `<span class="foo">foo</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
      )}</div></div>`,
      {
        hoistStatic: true,
        prefixIdentifiers: true,
        transformHoist: stringifyStatic,
        nodeTransforms: [
          node => {
            if (node.type === NodeTypes.ELEMENT && node.tag === 'img') {
              const exp = createSimpleExpression(
                '_imports_0_',
                false,
                node.loc,
                true
              )
              exp.isRuntimeConstant = true
              node.props[0] = {
                type: NodeTypes.DIRECTIVE,
                name: 'bind',
                arg: createSimpleExpression('src', true),
                exp,
                modifiers: [],
                loc: node.loc
              }
            }
          }
        ]
      }
    )
    // the expression and the tree are still hoistable
    expect(ast.hoists.length).toBe(1)
    // ...but the hoisted tree should not be stringified
    expect(ast.hoists[0]).toMatchObject({
      // if it's stringified it will be NodeTypes.CALL_EXPRESSION
      type: NodeTypes.VNODE_CALL
    })
  })
})
