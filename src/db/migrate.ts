import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MiDatabaseError } from '../errors.ts'
import type { Database } from './Database.ts'

const VERSION_PREFIX = /^(\d{4})_/
/**
 * Apply SQL migrations from a directory to a `Database` connection.
 *
 * Migration files are `NNNN_name.sql` (4-digit zero-padded version prefix).
 * Files are sorted numerically (`localeCompare(..., { numeric: true })`) so
 * `0009_*` precedes `0010_*` (lexicographic sort would reverse them).
 *
 * Each migration runs inside a transaction. On SQL failure the runner:
 *   1. Issues `ROLLBACK`
 *   2. Throws `MiDatabaseError` so the CLI handler can map it to exit 2.
 *
 * Re-running on an up-to-date DB is a no-op — the runner only applies
 * migrations whose version is greater than the highest row in
 * `_schema_version`.
 */
export class MigrationRunner {
  constructor(
    private readonly db: Database,
    private readonly migrationsDir: string,
  ) {}

  /**
   * Apply pending migrations. Returns the list of newly applied versions
   * in ascending order.
   */
  run(): number[] {
    this.ensureSchemaVersionTable()
    const files = this.listMigrationFiles()
    const applied: number[] = []

    for (const file of files) {
      const version = this.parseVersion(file)
      if (version <= this.currentVersion()) continue

      const sql = readFileSync(join(this.migrationsDir, file), 'utf8')
      this.applyOne(version, sql)
      applied.push(version)
    }

    return applied
  }

  /**
   * Highest applied schema version, or 0 if none.
   */
  currentVersion(): number {
    this.ensureSchemaVersionTable()
    const row = this.db.conn.query('SELECT MAX(version) AS v FROM _schema_version').get() as {
      v: number | null
    }
    return row.v ?? 0
  }

  private ensureSchemaVersionTable(): void {
    this.db.conn.exec(`
      CREATE TABLE IF NOT EXISTS _schema_version (
        version    INTEGER PRIMARY KEY,
        applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `)
  }

  private listMigrationFiles(): string[] {
    const entries = readdirSync(this.migrationsDir)
    return entries
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  private parseVersion(filename: string): number {
    const match = VERSION_PREFIX.exec(filename)
    if (!match) {
      throw new MiDatabaseError(`无法解析迁移文件版本号: ${filename}`)
    }
    return Number.parseInt(match[1] as string, 10)
  }

  private applyOne(version: number, sql: string): void {
    this.db.conn.exec('BEGIN')
    try {
      this.db.conn.exec(sql)
      this.db.conn.query('INSERT INTO _schema_version (version) VALUES (?)').run(version)
      this.db.conn.exec('COMMIT')
    } catch (err) {
      this.db.conn.exec('ROLLBACK')
      const message = err instanceof Error ? err.message : String(err)
      throw new MiDatabaseError(`迁移 ${version} 执行失败: ${message}`)
    }
  }
}
