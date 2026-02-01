import { join } from 'node:path'

import { SourceMapInput } from '@jridgewell/trace-mapping'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { Linter } from 'eslint'
import type { OutputAsset, OutputChunk } from 'rollup'
import { relativeToRoot } from './transform'

export interface UndefinedRef {
  name: string
  line?: number
  column?: number
}

const eslintConfig: Parameters<Linter['verify']>[1] = [
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: { 'no-undef': ['error'] },
  },
]

/**
 * Use ESLint `no-undef` rule to find undefined variable references. Returns
 * line/column of the first occurrence for each undefined name.
 */
export function findUndefinedRefs(code: string): UndefinedRef[] {
  const linter = new Linter({ configType: 'flat' })

  const messages = linter.verify(code, eslintConfig, 'chunk.js')

  const seen = new Set<string>()
  const refs: UndefinedRef[] = []

  for (const msg of messages) {
    if (msg.ruleId !== 'no-undef') continue

    //
    // ESLint message:
    //
    //     'foo' is not defined.
    //
    const name = msg.message.split("'")[1] ?? null

    if (!name || seen.has(name)) {
      continue
    }

    seen.add(name)

    refs.push({
      name,
      line: msg.line,
      column: msg.column,
    })
  }

  return refs
}

function checkChunk(
  chunk: OutputChunk,
  importSymbolsToSource: Map<string, string[]>,
  root: string,
  outputDir: string | undefined
): string[] {
  const errors: string[] = []
  const undefinedRefs = findUndefinedRefs(chunk.code)

  if (undefinedRefs.length === 0) {
    return errors
  }

  const moduleIdsInChunk = new Set(
    chunk.moduleIds ?? Object.keys(chunk.modules ?? {})
  )

  let traceMap: TraceMap | null = null

  for (const undefinedRef of undefinedRefs) {
    const sourceIds = importSymbolsToSource.get(undefinedRef.name)

    // Undefined reference not related to anything we stripped
    if (!sourceIds) {
      continue
    }

    const relevantSourceIds = sourceIds.filter(id => moduleIdsInChunk.has(id))

    // Also not related to anything we stripped
    if (relevantSourceIds.length === 0) {
      continue
    }

    let sourceOfError: string | null = null

    if (chunk.map && undefinedRef.line != null && undefinedRef.column != null) {
      const mapUrl = outputDir
        ? join(outputDir, chunk.sourcemapFileName ?? `${chunk.fileName}.map`)
        : null

      traceMap ??= new TraceMap(chunk.map as SourceMapInput, mapUrl)

      sourceOfError = originalPositionFor(traceMap, {
        line: undefinedRef.line,
        column: undefinedRef.column,
      }).source
    }

    const errorSourceIds = sourceOfError ? [sourceOfError] : relevantSourceIds

    const relativeSourceIds = outputDir
      ? errorSourceIds.map(id => relativeToRoot(id, root))
      : errorSourceIds

    errors.push(
      `Stripped conditional import binding '${undefinedRef.name}' still in output (${relativeSourceIds.sort().join(', ')})`
    )
  }

  return errors
}

/**
 * Check built chunks for undefined references that correspond to stripped
 * conditional imports.
 */
export function checkBundle(
  bundle: Record<string, OutputChunk | OutputAsset>,
  importSymbolsToSource: Map<string, string[]>,
  root: string, // Project root to resolve paths in error messages
  outputDir?: string // Build output directory to resolve source map paths
): string[] {
  if (importSymbolsToSource.size === 0) {
    return []
  }

  const errors: string[] = []

  for (const chunkOrAsset of Object.values(bundle)) {
    if (chunkOrAsset.type !== 'chunk') {
      continue
    }

    errors.push(
      ...checkChunk(chunkOrAsset, importSymbolsToSource, root, outputDir)
    )
  }

  return errors
}
