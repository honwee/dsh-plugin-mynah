import { describe, expect, it } from 'vitest'
import { Config, inject, name } from '../src/index.ts'

describe('Cordis plugin contract', () => {
  it('declares the tools seam and accepts an empty config', () => {
    expect(name).toBe('mynah')
    expect(inject).toEqual(['tools'])
    expect(Config({})).toEqual({ queueTimeoutMs: 90000 })
    expect(Config({ baseUrl: 'https://x:8443', insecureTls: true })).toMatchObject({ baseUrl: 'https://x:8443', insecureTls: true })
  })
  it('rejects wrong types before apply can run', () => {
    expect(() => Config({ insecureTls: 'yes' as never })).toThrow()
  })
})
