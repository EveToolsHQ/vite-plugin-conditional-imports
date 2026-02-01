import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  OutputAsset,
  OutputChunk,
  RollupOutput,
  RollupWatcher,
} from 'rollup'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import {
  conditionalImports,
  type Options,
  type ShouldStripFn,
} from 'vite-plugin-conditional-imports'

type BuildResult = Awaited<ReturnType<typeof build>>

function isRollupOutput(o: RollupOutput | RollupWatcher): o is RollupOutput {
  return !!o && typeof o === 'object' && 'output' in o
}

function getOutput(result: BuildResult): RollupOutput {
  const out = Array.isArray(result) ? result[0] : result

  if (!isRollupOutput(out)) {
    throw new Error('Expected RollupOutput')
  }

  return out
}

function isChunk(o: OutputChunk | OutputAsset): o is OutputChunk {
  return o.type === 'chunk'
}

function getFirstJsChunkCode(out: RollupOutput): string {
  const chunk = out.output
    .filter(o => isChunk(o))
    .find(c => c.fileName.endsWith('.js'))

  if (!chunk) {
    throw new Error('No JS chunk in output')
  }

  return chunk.code
}

const fixturesDir = join(__dirname, 'fixtures')

type ContextSnapshot = {
  source: string
  target: string
  resolvedTarget?: string
  withObject?: Record<string, string>
  configRoot: string
  envMode: string
}

function logContexts(
  ctxs: ContextSnapshot[],
  shouldStrip: ShouldStripFn
): ShouldStripFn {
  return async ctx => {
    ctxs.push({
      source: ctx.source,
      target: ctx.target,
      resolvedTarget: await ctx.resolvedTarget,
      withObject: ctx.withObject,
      configRoot: ctx.config.root,
      envMode: ctx.env.mode,
    })

    return await shouldStrip(ctx)
  }
}

interface BuildWithPluginOptions {
  fixture: string
  shouldStrip: ShouldStripFn
  mode: 'production' | 'development'
  shouldStripOptions?: Options
  /** When true, write bundle to disk (Vite default dist/ under fixture root). */
  write?: boolean
  sourceMap?: boolean | 'inline' | 'hidden'
}

function buildWithPlugin(options: BuildWithPluginOptions) {
  const { fixture, shouldStrip, mode, shouldStripOptions, write, sourceMap } =
    options

  const root = join(fixturesDir, fixture)

  return build({
    root,
    mode,
    logLevel: 'warn',
    build: {
      write: !!write,
      ...(sourceMap !== undefined && { sourcemap: sourceMap }),
      rollupOptions: {
        input: join(root, 'index.ts'),
        treeshake: true,
      },
    },
    plugins: [conditionalImports(shouldStrip, shouldStripOptions)],
  })
}

describe('vite-plugin-conditional-imports', () => {
  it('strips dev-only import', async () => {
    const ctxs: ContextSnapshot[] = []
    const result = await buildWithPlugin({
      fixture: 'dev-only-stripped',
      shouldStrip: logContexts(ctxs, ctx => ctx.withObject?.only === 'dev'),
      mode: 'production',
    })

    const out = getOutput(result)
    const code = getFirstJsChunkCode(out)

    expect(code).toContain('console.log')
    expect(code).toContain('Hello')
    expect(code).not.toMatch(/devOnly|debug|Dev only/)

    expect(ctxs).toHaveLength(1)
    expect(ctxs[0]).toMatchObject({
      source: 'index.ts',
      target: './devOnly',
      resolvedTarget: 'devOnly.ts',
      withObject: { only: 'dev' },
      configRoot: join(fixturesDir, 'dev-only-stripped'),
      envMode: 'production',
    })
  })

  it('keeps import when shouldStrip returns false', async () => {
    const result = await buildWithPlugin({
      fixture: 'dev-only-stripped',
      shouldStrip: () => false,
      mode: 'development',
    })

    const out = getOutput(result)
    const code = getFirstJsChunkCode(out)

    expect(code).toContain('debug')
    expect(code).toContain('Dev only')
    expect(code).toContain('Hello')
  })

  it('does not process type-only imports for stripping', async () => {
    const ctxs: ContextSnapshot[] = []
    const result = await buildWithPlugin({
      fixture: 'type-only',
      shouldStrip: logContexts(ctxs, ctx => ctx.withObject?.only === 'dev'),
      mode: 'production',
    })

    const out = getOutput(result)
    const code = getFirstJsChunkCode(out)

    expect(code).toContain('Hello')

    // Only the value import with attributes was passed. Type-only is skipped.
    expect(ctxs).toHaveLength(1)
    expect(ctxs[0]).toMatchObject({
      target: './devOnly',
      withObject: { only: 'dev' },
    })
  })

  it('fails build when stripped named import is still referenced', async () => {
    await expect(
      buildWithPlugin({
        fixture: 'dev-only-not-guarded',
        shouldStrip: ctx => ctx.withObject?.only === 'dev',
        mode: 'production',
      })
    ).rejects.toThrow(
      "Stripped conditional import binding 'debug' still in output (index.ts)"
    )
  })

  it('fails build when stripped default import is still referenced', async () => {
    await expect(
      buildWithPlugin({
        fixture: 'default-not-guarded',
        shouldStrip: ctx => ctx.withObject?.only === 'dev',
        mode: 'production',
      })
    ).rejects.toThrow(
      "Stripped conditional import binding 'debug' still in output (index.ts)"
    )
  })

  it('fails build when stripped namespace import is still referenced', async () => {
    await expect(
      buildWithPlugin({
        fixture: 'namespace-not-guarded',
        shouldStrip: ctx => ctx.withObject?.only === 'dev',
        mode: 'production',
      })
    ).rejects.toThrow(
      "Stripped conditional import binding 'devOnly' still in output (index.ts)"
    )
  })

  it('does not strip import without with when shouldStrip checks attributes', async () => {
    const result = await buildWithPlugin({
      fixture: 'import-without-with',
      shouldStrip: ctx => ctx.withObject?.only === 'dev',
      mode: 'production',
    })

    const out = getOutput(result)
    const code = getFirstJsChunkCode(out)

    expect(code).toContain('util')
  })

  it('strips one conditional import and keeps another in same file', async () => {
    const result = await buildWithPlugin({
      fixture: 'multiple-imports',
      shouldStrip: ctx => ctx.withObject?.only === 'dev',
      mode: 'production',
    })

    const out = getOutput(result)
    const code = getFirstJsChunkCode(out)

    expect(code).toContain('util')
    expect(code).toContain('Hello')
    expect(code).not.toContain('Dev only')
  })

  it('fails build with autoSourceMaps false and lists all files when multiple reference same dev symbol', async () => {
    await expect(
      buildWithPlugin({
        fixture: 'multiple-source-files',
        shouldStrip: ctx => ctx.withObject?.only === 'dev',
        mode: 'production',
        shouldStripOptions: { autoSourceMaps: false },
      })
    ).rejects.toThrow(
      "Stripped conditional import binding 'devOnly' still in output (a.ts, b.ts)"
    )
  })

  it('fails build with error pointing to file that references stripped binding', async () => {
    await expect(
      buildWithPlugin({
        fixture: 'multiple-source-files',
        shouldStrip: ctx => ctx.withObject?.only === 'dev',
        mode: 'production',
      })
    ).rejects.toThrow(
      "Stripped conditional import binding 'devOnly' still in output (a.ts)"
    )
  })

  it('deletes source maps after build when plugin enabled them (autoSourceMaps)', async () => {
    const fixture = 'dev-only-stripped'
    await buildWithPlugin({
      fixture,
      shouldStrip: ctx => ctx.withObject?.only === 'dev',
      mode: 'production',
      write: true,
    })

    const outDir = join(fixturesDir, fixture, 'dist/assets')
    const files = await readdir(outDir)
    const mapFiles = files.filter(f => f.endsWith('.map'))

    expect(mapFiles).toHaveLength(0)
  })

  it('keeps source maps when user set sourcemap to true', async () => {
    const fixture = 'dev-only-stripped'
    await buildWithPlugin({
      fixture,
      shouldStrip: ctx => ctx.withObject?.only === 'dev',
      mode: 'production',
      write: true,
      sourceMap: 'hidden',
    })

    const outDir = join(fixturesDir, fixture, 'dist/assets')
    const files = await readdir(outDir)
    const mapFiles = files.filter(f => f.endsWith('.map'))
    expect(mapFiles.length).toBeGreaterThan(0)
  })
})
