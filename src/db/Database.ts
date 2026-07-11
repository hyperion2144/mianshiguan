import { Database as BunDatabase } from 'bun:sqlite'

/**
 * Thin wrapper around `bun:sqlite`'s `Database` that enforces the two
 * project-wide pragmas on every connection:
 *
 *   - `journal_mode = wal` — writer/reader concurrency; reduces fsync cost.
 *   - `foreign_keys = ON` — enables FK enforcement at the connection level
 *     (SQLite defaults to OFF on every new connection).
 *
 * The wrapper exposes the raw connection via `conn` so callers can issue
 * prepared statements without going through another abstraction. Business
 * logic, schema bootstrapping, and migration orchestration live elsewhere.
 *
 * SQLite note: `journal_mode = wal` is silently coerced back to `'memory'`
 * for `:memory:` databases (WAL requires a real file). The pragma call is
 * still issued — it is a no-op there, not a skipped step.
 */
export class Database {
  readonly conn: BunDatabase

  constructor(path: string) {
    this.conn = new BunDatabase(path)
    // PRAGMA journal_mode returns the new mode; assign to discard the result.
    this.conn.exec('PRAGMA journal_mode = wal')
    this.conn.exec('PRAGMA foreign_keys = ON')
  }

  /**
   * Release the underlying connection. The on-disk file is intentionally
   * left in place — callers own the file lifecycle (e.g. `mi init` keeps
   * it, unlink callers do their own cleanup).
   */
  close(): void {
    this.conn.close()
  }
}