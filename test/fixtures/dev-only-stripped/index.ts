import debug from './devOnly' with { only: 'dev' }

if (import.meta.env.MODE === 'development') {
  debug()
}

console.log('Hello')
