import { describe, expect, it } from 'vitest'
import { MiError } from './errors.ts'

describe('MiError class hierarchy', () => {
  it('MiError carries message and default code E_MI', () => {
    const err = new MiError('foo')
    expect(err.message).toBe('foo')
    expect(err.code).toBe('E_MI')
    expect(err.name).toBe('MiError')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(MiError)
  })

  it('subclasses have distinct error codes', async () => {
    // Dynamic import so each subclass is loaded — verifies the type-chain
    // assertions and `instanceof` work after the module exports land.
    const mod = await import('./errors.ts')
    expect(new mod.MiValidationError('x').code).toBe('E_VALIDATION')
    expect(new mod.MiNotFoundError('x').code).toBe('E_NOT_FOUND')
    expect(new mod.MiConfigError('x').code).toBe('E_CONFIG')
    expect(new mod.MiDatabaseError('x').code).toBe('E_DATABASE')
  })

  it('MiValidationError preserves Chinese message and supports instanceof chain', async () => {
    const mod = await import('./errors.ts')
    const err = new mod.MiValidationError('请先运行 mi init 初始化配置')
    expect(err.message).toBe('请先运行 mi init 初始化配置')
    expect(err.code).toBe('E_VALIDATION')
    expect(err).toBeInstanceOf(MiError)
    expect(err).toBeInstanceOf(mod.MiValidationError)
    expect(err).toBeInstanceOf(Error)
  })

  it('subclass instances are also MiError (uniform base type)', async () => {
    const mod = await import('./errors.ts')
    const e1 = new mod.MiValidationError('a')
    const e2 = new mod.MiNotFoundError('b')
    const e3 = new mod.MiConfigError('c')
    const e4 = new mod.MiDatabaseError('d')
    expect(e1).toBeInstanceOf(MiError)
    expect(e2).toBeInstanceOf(MiError)
    expect(e3).toBeInstanceOf(MiError)
    expect(e4).toBeInstanceOf(MiError)
  })

  it('errors are catchable as Error across module boundaries', async () => {
    const mod = await import('./errors.ts')
    try {
      throw new mod.MiConfigError('boom')
    } catch (caught) {
      expect(caught).toBeInstanceOf(Error)
      expect(caught).toBeInstanceOf(MiError)
      expect(caught).toBeInstanceOf(mod.MiConfigError)
    }
  })
})