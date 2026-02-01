import * as devOnly from './devOnly' with { only: 'dev' }

devOnly.default()
console.log('Hello')
