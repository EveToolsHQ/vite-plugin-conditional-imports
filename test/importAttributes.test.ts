import { parse } from '@swc/core'
import { describe, expect, it } from 'vitest'
import type { ImportDeclaration, ModuleItem } from '@swc/core'
import { getImportAttributes } from '../src/importAttributes.js'

async function parseImport(source: string): Promise<ImportDeclaration> {
  const mod = await parse(source, { syntax: 'typescript' })

  const item = mod.body.find(
    (n: ModuleItem): n is ImportDeclaration => n.type === 'ImportDeclaration'
  )

  if (!item) {
    throw new Error('No ImportDeclaration in source')
  }

  return item
}

describe('importAttributes', () => {
  it('parses "only" from import with { only: "dev" }', async () => {
    const node = await parseImport("import foo from 'bar' with { only: 'dev' }")
    expect(getImportAttributes(node)).toEqual({ only: 'dev' })
  })

  it('returns undefined for import without with clause', async () => {
    const node = await parseImport("import foo from 'bar'")
    expect(getImportAttributes(node)).toEqual({})
  })

  it('parses multiple attributes from import with { mode, ssr }', async () => {
    const node = await parseImport(
      "import foo from 'bar' with { mode: 'dev', ssr: true }"
    )
    expect(getImportAttributes(node)).toEqual({
      mode: 'dev',
      ssr: true,
    })
  })
})
