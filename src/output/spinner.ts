import { createSpinner } from 'nanospinner'

/**
 * Wrap an async operation in a nanospinner with graceful non-TTY fallback.
 *
 * Behavior:
 *   - TTY (interactive terminal): show spinning indicator with `text`,
 *     swap to a checkmark on success or an X on failure.
 *   - Non-TTY (CI, scripts, piped output): no spinner, no output — just
 *     run `fn` and return its result. Errors propagate unchanged.
 *
 * The function always resolves with `fn`'s return value on success, or
 * re-throws on failure (after marking the spinner as failed if visible).
 */
export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) {
    return fn()
  }

  const spinner = createSpinner(text).start()
  try {
    const result = await fn()
    spinner.success({ text: `${text} ✓` })
    return result
  } catch (err) {
    spinner.error({ text: `${text} ✗` })
    throw err
  }
}
