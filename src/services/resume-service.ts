import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import pdfParse from 'pdf-parse'
import type { Database } from '../db/Database.ts'
import { MiDatabaseError, MiNotFoundError, MiValidationError } from '../errors.ts'
import type { ConfigService } from './config-service.ts'

/**
 * Public domain object that callers (CLI, future dashboard) consume for
 * the current resume state of a profile. The service constructs it from
 * a SQLite row so callers never touch snake_case columns.
 */
export interface ResumeSnapshot {
  profileId: string
  profileName: string
  text: string
  path: string | null
  sourceFormat: 'markdown' | 'pdf' | 'none'
  updatedAt: string
}

/**
 * One archived snapshot from `resume_history`. Returned by
 * `listHistory` newest-first.
 */
export interface ResumeHistoryEntry {
  id: number
  profileId: string
  text: string
  path: string | null
  archivedAt: string
}

/**
 * Options bag for `importFromFile`. `profileId` defaults to the
 * currently active profile; `maxBytes` defaults to 1 MiB.
 */
export interface ImportOptions {
  profileId?: string
  maxBytes?: number
}

/**
 * Options bag for `listHistory`. `limit` defaults to 50 and is
 * hard-capped at 500. `offset` defaults to 0 (newest-first).
 */
export interface ListHistoryOptions {
  limit?: number
  offset?: number
}

const DEFAULT_MAX_BYTES = 1_048_576 // 1 MiB
const DEFAULT_HISTORY_LIMIT = 50
const MAX_HISTORY_LIMIT = 500
const SUPPORTED_EXTENSIONS: Record<string, true> = {
  '.md': true,
  '.markdown': true,
  '.pdf': true,
}
interface ProfileResumeRow {
  id: string
  name: string
  resume_text: string
  resume_path: string | null
  updated_at: string
}

/** Snake-case row from `SELECT * FROM resume_history`. */
interface ResumeHistoryRow {
  id: number
  profile_id: string
  resume_text: string
  resume_path: string | null
  archived_at: string
}

function inferSourceFormat(path: string | null): ResumeSnapshot['sourceFormat'] {
  if (path === null) return 'none'
  const ext = extname(path).toLowerCase()
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.pdf') return 'pdf'
  return 'none'
}

function buildSnapshot(row: ProfileResumeRow): ResumeSnapshot {
  return {
    profileId: row.id,
    profileName: row.name,
    text: row.resume_text,
    path: row.resume_path,
    sourceFormat: inferSourceFormat(row.resume_path),
    updatedAt: row.updated_at,
  }
}

function resolveProfileId(options: ImportOptions, config: ConfigService): string {
  if (options.profileId !== undefined && options.profileId.length > 0) {
    return options.profileId
  }
  const active = config.load().defaultProfile
  if (active === undefined || active.length === 0) {
    throw new MiValidationError('请先创建或切换 Profile')
  }
  return active
}

function toMessage(err: unknown, action: string): string {
  const detail = err instanceof Error ? err.message : String(err)
  return `${action} 失败: ${detail}`
}

export function createResumeService(db: Database, config: ConfigService): ResumeService {
  return new ResumeService(db, config)
}

/**
 * Pure data + IO service for the resume domain. Mediates between CLI
 * handlers and the `profiles` + `resume_history` tables. All filesystem
 * reads and SQLite writes happen here; CLI handlers never reach into
 * `node:fs`, `pdf-parse`, or the SQLite connection directly.
 *
 * `importFromFile` is async because the PDF branch depends on the
 * Promise-returning `pdf-parse` library; Markdown reads, validation,
 * and DB writes are synchronous internally.
 */
export class ResumeService {
  constructor(
    private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  /**
   * Read a resume file (Markdown direct read, PDF via `pdf-parse`),
   * archive the previous resume snapshot into `resume_history` when one
   * exists, and overwrite `profiles.resume_text` / `profiles.resume_path`
   * / `profiles.updated_at`. Returns the freshly-imported snapshot.
   *
   * Validates path, extension, file size, and content before any write.
   * Throws `MiValidationError` for bad input, `MiNotFoundError` for an
   * unknown `profileId`, and `MiDatabaseError` for SQLite failures.
   */
  async importFromFile(filePath: string, options: ImportOptions = {}): Promise<ResumeSnapshot> {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new MiValidationError('路径不能为空')
    }
    if (!existsSync(filePath)) {
      throw new MiValidationError(`文件不存在: ${filePath}`)
    }
    const stat = statSync(filePath)
    if (!stat.isFile()) {
      throw new MiValidationError(`不是文件: ${filePath}`)
    }
    const ext = extname(filePath).toLowerCase()
    if (SUPPORTED_EXTENSIONS[ext] !== true) {
      throw new MiValidationError(`不支持的文件类型: ${ext || '(无扩展名)'}`)
    }
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    if (stat.size > maxBytes) {
      throw new MiValidationError(`文件过大，超过 ${maxBytes} 字节`)
    }

    const profileId = resolveProfileId(options, this.config)
    const existing = this.loadProfileRow(profileId)
    if (existing === null) {
      throw new MiNotFoundError(`Profile 不存在: ${profileId}`)
    }

    const text = await this.extractText(filePath, ext)
    if (text.trim().length === 0) {
      throw new MiValidationError('文件内容为空')
    }

    try {
      this.archiveIfPresent(existing)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, '存档旧简历'))
    }

    try {
      this.db.conn
        .query(
          "UPDATE profiles SET resume_text = ?, resume_path = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(text, filePath, profileId)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, '更新简历'))
    }

    const refreshed = this.loadProfileRow(profileId)
    if (refreshed === null) {
      throw new MiDatabaseError('importFromFile: row missing after update')
    }
    return buildSnapshot(refreshed)
  }

  /**
   * Return the current resume snapshot for a profile. When `profileId`
   * is omitted, falls back to the active profile from `ConfigService`.
   * `sourceFormat` is inferred from the path extension. May return
   * `text === ''` and `path === null` for a profile that has never
   * imported a resume.
   */
  getCurrent(profileId?: string): ResumeSnapshot {
    const id =
      profileId !== undefined && profileId.length > 0
        ? profileId
        : resolveProfileId({}, this.config)
    const row = this.loadProfileRow(id)
    if (row === null) {
      throw new MiNotFoundError(`Profile 不存在: ${id}`)
    }
    return buildSnapshot(row)
  }

  /**
   * Return archived resume snapshots for a profile, newest-first
   * (`archived_at DESC, id DESC`). `limit` defaults to 50 and is
   * hard-capped at 500.
   */
  listHistory(profileId?: string, options: ListHistoryOptions = {}): ResumeHistoryEntry[] {
    const id =
      profileId !== undefined && profileId.length > 0
        ? profileId
        : resolveProfileId({}, this.config)
    const row = this.loadProfileRow(id)
    if (row === null) {
      throw new MiNotFoundError(`Profile 不存在: ${id}`)
    }

    const limit = Math.min(options.limit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT)
    const offset = options.offset ?? 0

    const rows = this.db.conn
      .query(
        `SELECT id, profile_id, resume_text, resume_path, archived_at
         FROM resume_history
         WHERE profile_id = ?
         ORDER BY archived_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(id, limit, offset) as ResumeHistoryRow[]

    return rows.map((r) => ({
      id: r.id,
      profileId: r.profile_id,
      text: r.resume_text,
      path: r.resume_path,
      archivedAt: r.archived_at,
    }))
  }

  private loadProfileRow(profileId: string): ProfileResumeRow | null {
    return this.db.conn
      .query('SELECT id, name, resume_text, resume_path, updated_at FROM profiles WHERE id = ?')
      .get(profileId) as ProfileResumeRow | null
  }

  private archiveIfPresent(existing: ProfileResumeRow): void {
    if (existing.resume_text.length === 0 && existing.resume_path === null) {
      return
    }
    this.db.conn
      .query(
        `INSERT INTO resume_history (profile_id, resume_text, resume_path)
         VALUES (?, ?, ?)`,
      )
      .run(existing.id, existing.resume_text, existing.resume_path)
  }

  private async extractText(filePath: string, ext: string): Promise<string> {
    const buffer = readFileSync(filePath)
    if (ext === '.pdf') {
      return parsePdfText(buffer)
    }
    return buffer.toString('utf8')
  }
}

/**
 * Extract text from a PDF buffer via `pdf-parse`. Wraps any parser
 * failure in `MiValidationError` so the CLI maps it to a user-correctable
 * exit 1 rather than a raw library error.
 */
async function parsePdfText(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer)
    return data.text
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new MiValidationError(`PDF 解析失败: ${detail}`)
  }
}
