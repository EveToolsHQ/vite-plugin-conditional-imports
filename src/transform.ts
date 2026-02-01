import path from 'node:path'

import type { ModuleItem } from '@swc/core'
import { parse, print } from '@swc/core'
import { ConfigEnv, normalizePath, ResolvedConfig } from 'vite'
import type { PluginContext } from 'rollup'

import { getImportAttributes } from './importAttributes.js'
import type { ShouldStripContext, ShouldStripFn } from './index.js'

export function relativeToRoot(filePath: string, root: string): string {
  const rel = path.relative(root, filePath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return filePath
  return normalizePath(rel)
}

export interface TransformContext {
  resolve: PluginContext['resolve']
  config: ResolvedConfig
  env: ConfigEnv
}

export interface TransformResult {
  code: string
  map: string | null
  strippedImportTargets: Set<string>
  strippedImportSymbols: Set<string>
  relativeSource: string
}

export async function transform(
  code: string,
  id: string,
  shouldStrip: ShouldStripFn,
  context: TransformContext
): Promise<TransformResult | null> {
  const mod = await parse(code, {
    syntax: 'typescript',
    tsx: id.endsWith('.tsx'),
  })

  const resolveCache = new Map<string, Promise<string>>()
  const strippedImportTargets = new Set<string>()
  const strippedImportSymbols = new Set<string>()

  const source = relativeToRoot(id, context.config.root)
  const body: (ModuleItem | Promise<ModuleItem | null>)[] = []

  for (const item of mod.body) {
    if (item.type !== 'ImportDeclaration' || item.typeOnly) {
      body.push(item)
      continue
    }

    const target = item.source.value
    const withObject = getImportAttributes(item)

    const ctx: ShouldStripContext = {
      target,
      get resolvedTarget() {
        let promise = resolveCache.get(target)

        if (promise) {
          return promise
        }

        promise = context
          .resolve(target, id)
          .then(r => relativeToRoot(r?.id ?? target, context.config.root))

        resolveCache.set(target, promise)

        return promise
      },
      source,
      withObject,
      config: context.config,
      env: context.env,
    }

    const promise = Promise.resolve(shouldStrip(ctx)).then((strip: boolean) => {
      if (!strip) {
        return item
      }

      strippedImportTargets.add(target)

      for (const spec of item.specifiers) {
        strippedImportSymbols.add(spec.local.value)
      }

      return null
    })

    body.push(promise)
  }

  const results = await Promise.all(body)

  mod.body = results.filter((item): item is ModuleItem => item != null)

  if (strippedImportSymbols.size === 0) {
    return null
  }

  const out = await print(mod, {
    sourceMaps: true,
    filename: source,
  })

  return {
    code: out.code,
    map: out.map ?? null,
    strippedImportTargets,
    strippedImportSymbols,
    relativeSource: source,
  }
}
