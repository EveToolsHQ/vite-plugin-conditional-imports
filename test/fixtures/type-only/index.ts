import type { DevType } from './devOnly'
import { devValue } from './devOnly' with { only: 'dev' }

const x: DevType = { dev: true }

if (import.meta.env.MODE === 'development') {
  console.log(devValue)
}

console.log('Hello', x)
