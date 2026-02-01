import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import createDebug from 'debug'
import type { Plugin } from 'vite'
import type { ConfigEnv, ResolvedConfig } from 'vite'

import { checkBundle } from './check.js'
import { transform } from './transform.js'

const log = createDebug('vite-plugin-conditional-imports')

export interface ShouldStripContext {
  /** Raw import target as is from source code. */
  target: string

  /**
   * Resolved import path (relative to project root). Lazy, resolution runs only
   * when you access it.
   */
  resolvedTarget: Promise<string>

  /** The file where the import is found, relative to project root. */
  source: string

  /** Import attributes from `with { ... }` clause (e.g. `{ only: 'dev' }`). */
  withObject: Record<string, string>

  /** Vite config. */
  config: ResolvedConfig

  /** Vite env. */
  env: ConfigEnv
}

export type ShouldStripFn = (
  ctx: ShouldStripContext
) => boolean | Promise<boolean>

export interface Options {
  /**
   * When `true` (default), the plugin enables Vite source maps (`hidden` mode)
   * and uses them to resolve error locations and provide more useful error
   * messages. If source maps were initially off, the source maps are removed
   * after the build.
   *
   * If you don't want this plugin to touch your source maps configuration and
   * output folder, set this to `false`.
   */
  autoSourceMaps?: boolean

  /**
   * When `false` (default), the plugin only runs in `vite build`. If you set it
   * to `true`, it also runs in `vite serve`.
   */
  applyInServe?: boolean
}

export function conditionalImports(
  shouldStrip: ShouldStripFn,
  options?: Options
): Plugin {
  const autoSourceMaps = options?.autoSourceMaps !== false
  const applyInServe = options?.applyInServe === true
  let pluginRequestedSourcemap = false

  const importSymbolsToSource = new Map<string, string[]>()

  let cachedConfig: ResolvedConfig | undefined
  let cachedEnv: ConfigEnv | undefined

  return {
    name: 'vite-plugin-conditional-imports',
    enforce: 'pre',
    apply: applyInServe ? undefined : 'build',

    config(userConfig, env) {
      cachedEnv = env

      if (!autoSourceMaps) {
        return
      }

      if (
        env.command === 'build' &&
        (userConfig.build?.sourcemap == null ||
          userConfig.build?.sourcemap === false)
      ) {
        pluginRequestedSourcemap = true

        return {
          build: {
            sourcemap: 'hidden',
          },
        }
      }
    },

    configResolved(config) {
      cachedConfig = config
    },

    buildStart() {
      importSymbolsToSource.clear()
    },

    async transform(code, id) {
      if (!cachedConfig || !cachedEnv) {
        return this.error(
          'vite-plugin-conditional-imports: config or env not resolved'
        )
      }

      if (!/\.(tsx?|jsx?|mts|mjs)$/.test(id)) {
        return null
      }

      const result = await transform(code, id, shouldStrip, {
        resolve: this.resolve,
        config: cachedConfig,
        env: cachedEnv,
      })

      if (!result) {
        return null
      }

      for (const target of result.strippedImportTargets) {
        log('stripped import in %s: %s', result.relativeSource, target)
      }

      for (const name of result.strippedImportSymbols) {
        const list = importSymbolsToSource.get(name) ?? []
        list.push(id)
        importSymbolsToSource.set(name, list)
      }

      return { code: result.code, map: result.map }
    },

    generateBundle(options, bundle) {
      if (!cachedConfig) {
        return
      }

      const errors = checkBundle(
        bundle,
        importSymbolsToSource,
        cachedConfig.root,
        options.dir
      )

      if (errors.length > 0) {
        this.error(errors.join('\n'))
      }
    },

    async writeBundle(options, bundle) {
      if (!pluginRequestedSourcemap || !options.dir) return
      for (const name of Object.keys(bundle)) {
        if (name.endsWith('.map')) {
          await unlink(join(options.dir, name)).catch(() => {})
        }
      }
    },
  }
}
