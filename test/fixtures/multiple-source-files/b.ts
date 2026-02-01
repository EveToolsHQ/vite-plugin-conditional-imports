import { devOnly } from './devOnly' with { only: 'dev' }

export function getB() {
  return devOnly
}
