import { escapeHtml } from './ssrUtils'
import {
  normalizeClass,
  normalizeStyle,
  propsToAttrMap,
  hyphenate,
  isString,
  isNoUnitNumericStyleProp,
  isOn,
  isSSRSafeAttrName,
  isBooleanAttr
} from '@vue/shared'

export function renderProps(
  props: Record<string, unknown>,
  isCustomElement: boolean = false
): string {
  let ret = ''
  for (const key in props) {
    if (key === 'key' || key === 'ref' || isOn(key)) {
      continue
    }
    const value = props[key]
    if (key === 'class') {
      ret += ` class="${renderClass(value)}"`
    } else if (key === 'style') {
      ret += ` style="${renderStyle(value)}"`
    } else if (value != null) {
      const attrKey = isCustomElement
        ? key
        : propsToAttrMap[key] || key.toLowerCase()
      if (isBooleanAttr(attrKey)) {
        if (value !== false) {
          ret += ` ${attrKey}`
        }
      } else if (isSSRSafeAttrName(attrKey)) {
        ret += ` ${attrKey}="${escapeHtml(value)}"`
      }
    }
  }
  return ret
}

export function renderClass(raw: unknown): string {
  return escapeHtml(normalizeClass(raw))
}

export function renderStyle(raw: unknown): string {
  if (!raw) {
    return ''
  }
  if (isString(raw)) {
    return escapeHtml(raw)
  }
  const styles = normalizeStyle(raw)
  let ret = ''
  for (const key in styles) {
    const value = styles[key]
    const normalizedKey = key.indexOf(`--`) === 0 ? key : hyphenate(key)
    if (
      isString(value) ||
      (typeof value === 'number' && isNoUnitNumericStyleProp(normalizedKey))
    ) {
      // only render valid values
      ret += `${normalizedKey}:${value};`
    }
  }
  return escapeHtml(ret)
}
