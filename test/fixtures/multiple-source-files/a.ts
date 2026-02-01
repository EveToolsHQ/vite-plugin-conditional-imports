import { devOnly } from './devOnly' with { only: 'dev' }

export function getA() {
  return devOnly
}
