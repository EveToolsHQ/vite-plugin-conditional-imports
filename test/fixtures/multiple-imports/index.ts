import { debug } from './devOnly' with { only: 'dev' }
import util from './util'

if (import.meta.env.MODE === 'development') {
  debug()
}

console.log('Hello', util())
