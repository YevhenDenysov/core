import {
  ElementNode,
  ObjectExpression,
  createObjectExpression,
  NodeTypes,
  createObjectProperty,
  createSimpleExpression,
  createFunctionExpression,
  DirectiveNode,
  ElementTypes,
  ExpressionNode,
  Property,
  TemplateChildNode,
  SourceLocation,
  createConditionalExpression,
  ConditionalExpression,
  JSChildNode,
  SimpleExpressionNode
} from '../ast'
import { TransformContext, NodeTransform } from '../transform'
import { createCompilerError, ErrorCodes } from '../errors'
import { mergeExpressions, findNonEmptyDir } from '../utils'

export const isVSlot = (p: ElementNode['props'][0]): p is DirectiveNode =>
  p.type === NodeTypes.DIRECTIVE && p.name === 'slot'

const isStaticExp = (p: JSChildNode): p is SimpleExpressionNode =>
  p.type === NodeTypes.SIMPLE_EXPRESSION && p.isStatic

const defaultFallback = createSimpleExpression(`undefined`, false)

// A NodeTransform that tracks scope identifiers for scoped slots so that they
// don't get prefixed by transformExpression. This transform is only applied
// in non-browser builds with { prefixIdentifiers: true }
export const trackSlotScopes: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ELEMENT &&
    (node.tagType === ElementTypes.COMPONENT ||
      node.tagType === ElementTypes.TEMPLATE)
  ) {
    const vSlot = node.props.find(isVSlot)
    if (vSlot && vSlot.exp) {
      context.addIdentifiers(vSlot.exp)
      return () => {
        context.removeIdentifiers(vSlot.exp!)
      }
    }
  }
}

// Instead of being a DirectiveTransform, v-slot processing is called during
// transformElement to build the slots object for a component.
export function buildSlots(
  { props, children, loc }: ElementNode,
  context: TransformContext
): {
  slots: ObjectExpression
  hasDynamicSlots: boolean
} {
  const slots: Property[] = []
  let hasDynamicSlots = false

  // 1. Check for default slot with slotProps on component itself.
  //    <Comp v-slot="{ prop }"/>
  const explicitDefaultSlot = props.find(isVSlot)
  if (explicitDefaultSlot) {
    const { arg, exp, loc } = explicitDefaultSlot
    if (arg) {
      context.onError(
        createCompilerError(ErrorCodes.X_NAMED_SLOT_ON_COMPONENT, loc)
      )
    }
    slots.push(buildDefaultSlot(exp, children, loc))
  }

  // 2. Iterate through children and check for template slots
  //    <template v-slot:foo="{ prop }">
  let hasTemplateSlots = false
  let extraneousChild: TemplateChildNode | undefined = undefined
  const seenSlotNames = new Set<string>()
  for (let i = 0; i < children.length; i++) {
    const slotElement = children[i]
    let slotDir

    if (
      slotElement.type !== NodeTypes.ELEMENT ||
      slotElement.tagType !== ElementTypes.TEMPLATE ||
      !(slotDir = slotElement.props.find(isVSlot))
    ) {
      // not a <template v-slot>, skip.
      extraneousChild = extraneousChild || slotElement
      continue
    }

    if (explicitDefaultSlot) {
      // already has on-component default slot - this is incorrect usage.
      context.onError(
        createCompilerError(ErrorCodes.X_MIXED_SLOT_USAGE, slotDir.loc)
      )
      break
    }

    hasTemplateSlots = true
    const { children: slotChildren, loc: slotLoc } = slotElement
    const {
      arg: slotName = createSimpleExpression(`default`, true),
      exp: slotProps,
      loc: dirLoc
    } = slotDir

    // check if name is dynamic.
    let staticSlotName
    if (isStaticExp(slotName)) {
      staticSlotName = slotName ? slotName.content : `default`
    } else {
      hasDynamicSlots = true
    }

    const slotFunction = createFunctionExpression(
      slotProps,
      slotChildren,
      false,
      slotChildren.length ? slotChildren[0].loc : slotLoc
    )

    // check if this slot is conditional (v-if/else/else-if)
    let vIf
    let vElse
    if ((vIf = findNonEmptyDir(slotElement, 'if'))) {
      hasDynamicSlots = true
      slots.push(
        createObjectProperty(
          slotName,
          createConditionalExpression(vIf.exp!, slotFunction, defaultFallback)
        )
      )
    } else if ((vElse = findNonEmptyDir(slotElement, /^else(-if)?$/))) {
      hasDynamicSlots = true
      // find adjacent v-if slot
      let vIfBase
      let i = slots.length
      while (i--) {
        if (slots[i].value.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
          vIfBase = slots[i]
          break
        }
      }
      if (vIfBase) {
        // check if the v-else and the base v-if has the same slot name
        if (
          isStaticExp(vIfBase.key) &&
          vIfBase.key.content === staticSlotName
        ) {
          let conditional = vIfBase.value as ConditionalExpression
          while (
            conditional.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION
          ) {
            conditional = conditional.alternate
          }
          conditional.alternate = vElse.exp
            ? createConditionalExpression(
                vElse.exp,
                slotFunction,
                defaultFallback
              )
            : slotFunction
        } else {
          // not the same slot name. generate a separate property.
          slots.push(
            createObjectProperty(
              slotName,
              createConditionalExpression(
                // negate baseVIf
                mergeExpressions(
                  `!(`,
                  (vIfBase.value as ConditionalExpression).test,
                  `)`,
                  ...(vElse.exp ? [` && (`, vElse.exp, `)`] : [])
                ),
                slotFunction,
                defaultFallback
              )
            )
          )
        }
      } else {
        context.onError(
          createCompilerError(ErrorCodes.X_ELSE_NO_ADJACENT_IF, vElse.loc)
        )
      }
    } else {
      // check duplicate static names
      if (staticSlotName) {
        if (seenSlotNames.has(staticSlotName)) {
          context.onError(
            createCompilerError(ErrorCodes.X_DUPLICATE_SLOT_NAMES, dirLoc)
          )
          continue
        }
        seenSlotNames.add(staticSlotName)
      }
      slots.push(createObjectProperty(slotName, slotFunction))
    }
  }

  if (hasTemplateSlots && extraneousChild) {
    context.onError(
      createCompilerError(
        ErrorCodes.X_EXTRANEOUS_NON_SLOT_CHILDREN,
        extraneousChild.loc
      )
    )
  }

  if (!explicitDefaultSlot && !hasTemplateSlots) {
    // implicit default slot.
    slots.push(buildDefaultSlot(undefined, children, loc))
  }

  return {
    slots: createObjectExpression(slots, loc),
    hasDynamicSlots
  }
}

function buildDefaultSlot(
  slotProps: ExpressionNode | undefined,
  children: TemplateChildNode[],
  loc: SourceLocation
): Property {
  return createObjectProperty(
    createSimpleExpression(`default`, true),
    createFunctionExpression(
      slotProps,
      children,
      false,
      children.length ? children[0].loc : loc
    )
  )
}
