import type { ImportDeclaration, ObjectExpression, Property } from '@swc/core'

// Runtime uses `with` but types still have `asserts`.
function getWithObject(
  node: ImportDeclaration & { with?: ObjectExpression }
): ObjectExpression | undefined {
  return node.with ?? node.asserts
}

// Import attributes grammar only allows `key: string pairs` (no spread).
// SWC types use generic `ObjectExpression`, so we assert `Property[]`.
function getAttrList(node: ImportDeclaration): Property[] {
  const withObj = getWithObject(node)
  return (withObj?.properties as Property[]) ?? []
}

function getKey(attr: Property): string | undefined {
  const k = 'key' in attr ? attr.key : undefined
  return k && typeof k === 'object' && 'value' in k
    ? (k as { value: string }).value
    : undefined
}

function getVal(attr: Property): string | undefined {
  const v = 'value' in attr ? attr.value : undefined
  return v && typeof v === 'object' && 'value' in v
    ? (v as { value: string }).value
    : undefined
}

/**
 * Get all import attributes from an SWC `ImportDeclaration` as a plain object.
 *
 * I.e. from:
 *
 *     import foo from 'bar' with { only: 'dev', ssr: true }
 *
 * Returns:
 *
 *     { only: 'dev', ssr: true }
 */
export function getImportAttributes(
  node: ImportDeclaration
): Record<string, string> {
  const list = getAttrList(node)
  const out: Record<string, string> = {}

  for (const attr of list) {
    const key = getKey(attr)
    const val = getVal(attr)

    if (key != null && val != null) {
      out[key] = val
    }
  }

  return out
}
