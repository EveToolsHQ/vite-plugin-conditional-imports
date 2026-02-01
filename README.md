# vite-plugin-conditional-imports

[![npm version](https://img.shields.io/npm/v/vite-plugin-conditional-imports.svg)](https://www.npmjs.com/package/vite-plugin-conditional-imports)

> Vite plugin to strip imports conditionally.

Typical use case:

```js
import debug from './debug' with { only: 'dev' }

if (import.meta.env.DEV) {
  debug()
}
```

This plugin can be configured to strip the `./debug` import when
building for production. Then we rely on Rollup's tree shaking to remove
the dead code during a production build.

If we forget to guard dev code, the plugin notices missing references in
the chunk output and **fails the build**.

You can also perform stripping based on the import path itself.

## Usage

Strip based on `import with` metadata:

```js
import { defineConfig } from 'vite'
import { conditionalImports } from 'vite-plugin-conditional-imports'

export default defineConfig({
  plugins: [
    conditionalImports(ctx => {
      // Strip in production when import has `with { only: 'dev' }`
      return ctx.config.mode === 'production' && ctx.withObject?.only === 'dev'
    }),
  ],
})
```

Strip based on path:

```js
export default defineConfig({
  plugins: [
    conditionalImports(async ctx => {
      // Strip in production when import paths contains `/dev/`
      return (
        ctx.config.mode === 'production' &&
        (await ctx.resolvedTarget).includes('/dev/')
      )
    }),
  ],
})
```

## Context object

| Property         | Description                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`         | Import specifier as written in source (e.g. `./dev-only.js`, `@lib/custom`).                                                                        |
| `resolvedTarget` | `Promise<string>`, resolved path relative to Vite's `config.root`. Lazy: resolution runs only when you access it (e.g. `await ctx.resolvedTarget`). |
| `source`         | Path of the file that contains the import, relative to `config.root`.                                                                               |
| `withObject`     | Import attributes from `with { ... }` (e.g. `{ only: 'dev' }`).                                                                                     |
| `config`         | Resolved Vite config (`config.mode`, `config.build.ssr`, etc.).                                                                                     |
| `env`            | Vite config env (`env.mode`, `env.ssrBuild`, etc.).                                                                                                 |

## Extra options

You can pass an options object after the callback functon with the following properties:

| Option           | Type      | Default | Description                                                                                                                                                                                                                                                                                                                          |
| ---------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `autoSourceMaps` | `boolean` | `true`  | When `true`, the plugin enables Vite sourcemaps (if not set) and uses them to resolve error locations to the original file. When `false`, it does not touch the config, and if source maps are not already enabled, it falls back to reporting all files where a given import was stripped, which is less useful, but builds faster. |
| `applyInServe`   | `boolean` | `false` | Set to `true` to also use the plugin with `vite serve`.                                                                                                                                                                                                                                                                              |
