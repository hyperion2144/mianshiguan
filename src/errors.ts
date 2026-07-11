/**
 * mianshiguan typed error hierarchy.
 *
 * All domain-typed errors thrown by services and commands MUST extend
 * `MiError`. CLI handlers map `MiError.code` to exit codes:
 *
 *   - User errors (E_VALIDATION, E_NOT_FOUND, E_CONFIG) → exit 1
 *   - System errors (E_DATABASE) → exit 2
 *
 * Subclasses carry Chinese user-facing messages and a stable `code`
 * that downstream code can pattern-match without parsing the message.
 */
export class MiError extends Error {
  readonly code: string

  constructor(message: string, code = 'E_MI') {
    super(message)
    this.name = 'MiError'
    this.code = code
    // Restore prototype chain — required when extending Error in TS ES2020+
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class MiValidationError extends MiError {
  constructor(message: string) {
    super(message, 'E_VALIDATION')
    this.name = 'MiValidationError'
  }
}

export class MiNotFoundError extends MiError {
  constructor(message: string) {
    super(message, 'E_NOT_FOUND')
    this.name = 'MiNotFoundError'
  }
}

export class MiConfigError extends MiError {
  constructor(message: string) {
    super(message, 'E_CONFIG')
    this.name = 'MiConfigError'
  }
}

export class MiDatabaseError extends MiError {
  constructor(message: string) {
    super(message, 'E_DATABASE')
    this.name = 'MiDatabaseError'
  }
}