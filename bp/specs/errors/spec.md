# Error Hierarchy Specification

## Purpose

The errors module defines a typed error hierarchy for the mianshiguan application. All domain errors extend a base `MiError` class carrying a stable string `code` that CLI handlers can pattern-match on to determine the appropriate exit code. Each subclass represents a distinct category: user-correctable validation errors (exit 1) or system-level database errors (exit 2).

## Requirements

### Requirement: ERR-1 — Base error with code
The system SHALL provide a base `MiError` class that extends `Error`. Every `MiError` SHALL carry a `code` string property. When no code is provided, the default SHALL be `"E_MI"`.

#### Scenario: Default error code is E_MI
- GIVEN code creates `new MiError("foo")`
- WHEN the error is inspected
- THEN `message` SHALL be `"foo"`, `code` SHALL be `"E_MI"`, and `name` SHALL be `"MiError"`
- THEN the error SHALL be `instanceof Error` and `instanceof MiError`

### Requirement: ERR-2 — Subclass error codes
The system SHALL provide four error subclasses, each with a distinct error code:
- `MiValidationError` → code `"E_VALIDATION"`
- `MiNotFoundError` → code `"E_NOT_FOUND"`
- `MiConfigError` → code `"E_CONFIG"`
- `MiDatabaseError` → code `"E_DATABASE"`

#### Scenario: Each subclass has the correct code
- GIVEN instances of each subclass are created
- WHEN their `code` property is checked
- THEN `MiValidationError` SHALL have `"E_VALIDATION"`, `MiNotFoundError` SHALL have `"E_NOT_FOUND"`, `MiConfigError` SHALL have `"E_CONFIG"`, and `MiDatabaseError` SHALL have `"E_DATABASE"`

### Requirement: ERR-3 — Subclass instanceof chain
Every subclass instance SHALL be `instanceof` itself, `instanceof MiError`, and `instanceof Error`.

#### Scenario: Subclass instance satisfies instanceof chain
- GIVEN a `MiConfigError` instance
- WHEN `instanceof` checks are performed
- THEN the instance SHALL be `instanceof Error`, `instanceof MiError`, and `instanceof MiConfigError`

### Requirement: ERR-4 — Cross-module catchability
Errors SHALL remain catchable as `Error`, `MiError`, and their specific subclass across module boundaries (dynamic `import()`).

#### Scenario: Error caught correctly after dynamic import
- GIVEN code throws a `MiValidationError` imported dynamically
- WHEN caught in a `try/catch` block
- THEN the caught value SHALL be `instanceof Error`, `instanceof MiError`, and `instanceof MiValidationError`

### Requirement: ERR-5 — Chinese user-facing messages
Error messages from the system SHALL be in Chinese for user-facing error conditions (validation, not-found, config).

#### Scenario: Validation error preserves Chinese message
- GIVEN a `MiValidationError` is created with a Chinese message
- WHEN the message is read
- THEN it SHALL contain the original Chinese text

### Requirement: ERR-6 — Prototype chain restoration
Subclasses MUST extend `Error` correctly in an ES2020+ environment by calling `Object.setPrototypeOf(this, new.target.prototype)`.

#### Scenario: Prototype chain is correct
- GIVEN any `MiError` subclass is instantiated
- WHEN its prototype chain is inspected
- THEN it SHALL produce the correct `instanceof` results for `Error`, `MiError`, and the specific subclass

## Error Handling

- `MiValidationError` (E_VALIDATION) — user input errors: empty name, invalid format, missing required arguments → CLI exits 1
- `MiNotFoundError` (E_NOT_FOUND) — entity not found: profile not found, config not initialized → CLI exits 1
- `MiConfigError` (E_CONFIG) — configuration errors: missing config.yml, invalid enum values → CLI exits 1
- `MiDatabaseError` (E_DATABASE) — system errors: SQL failure, migration failure → CLI exits 2

## Interfaces

```typescript
class MiError extends Error {
  readonly code: string
  constructor(message: string, code?: string)  // default code: "E_MI"
}

class MiValidationError extends MiError {
  constructor(message: string)  // code: "E_VALIDATION"
}

class MiNotFoundError extends MiError {
  constructor(message: string)  // code: "E_NOT_FOUND"
}

class MiConfigError extends MiError {
  constructor(message: string)  // code: "E_CONFIG"
}

class MiDatabaseError extends MiError {
  constructor(message: string)  // code: "E_DATABASE"
}
```
