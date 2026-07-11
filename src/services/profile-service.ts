import { ulid } from 'ulid'
import type { Database } from '../db/Database.ts'
import { MiDatabaseError, MiNotFoundError, MiValidationError } from '../errors.ts'
import type { Config, ConfigService } from './config-service.ts'

/**
 * Public domain object — what callers (CLI, future dashboard) actually
 * consume. Camel-case fields, JSON-encoded array columns pre-parsed.
 * Constructed from the SQLite row inside the service so no caller ever
 * touches snake_case.
 */
export interface Profile {
  id: string // ULID, 26-char Crockford base32
  name: string // unique business key
  resumeText: string
  resumePath: string | null
  targetRole: string
  jd: string
  skills: string[]
  targetCompanies: string[]
  notes: string
  avatarPath: string | null
  createdAt: string // ISO 8601, sqlite datetime('now')
  updatedAt: string
}

/**
 * Input for `ProfileService.create`. Only `name` is required; all other
 * fields fall back to schema defaults when omitted.
 */
export interface CreateProfileInput {
  name: string // required, unique (case-sensitive)
  resumeText?: string
  resumePath?: string | null
  targetRole?: string
  jd?: string
  skills?: string[]
  targetCompanies?: string[]
  notes?: string
  avatarPath?: string | null
}

/**
 * Partial-update patch. Each field is optional; the service re-validates
 * the supplied subset and re-serialises array columns before write.
 */
export type UpdateProfilePatch = Partial<Omit<CreateProfileInput, never>>

/**
 * The set of fields the service layer is willing to write on update.
 * Centralised here so the CLI `mi profile update <field>` whitelist and
 * the service share one source of truth.
 */
export const UPDATABLE_FIELDS = [
  'name',
  'resumeText',
  'resumePath',
  'targetRole',
  'jd',
  'skills',
  'targetCompanies',
  'notes',
  'avatarPath',
] as const

export type UpdatableField = (typeof UPDATABLE_FIELDS)[number]

export function isUpdatableField(field: string): field is UpdatableField {
  return (UPDATABLE_FIELDS as readonly string[]).includes(field)
}

/**
 * Snake-case row shape returned by `SELECT * FROM profiles`. Local to
 * the service so the rest of the codebase never sees the schema's
 * snake_case columns.
 */
interface ProfileRowRaw {
  id: string
  name: string
  resume_text: string
  resume_path: string | null
  target_role: string
  jd: string
  skills: string
  target_companies: string
  notes: string
  avatar_path: string | null
  created_at: string
  updated_at: string
}

const NAME_EMPTY_MESSAGE = '名称不能为空'
const DUPLICATE_NAME_MESSAGE = (name: string) => `name 已存在: ${name}`

function rowToProfile(row: ProfileRowRaw): Profile {
  return {
    id: row.id,
    name: row.name,
    resumeText: row.resume_text,
    resumePath: row.resume_path,
    targetRole: row.target_role,
    jd: row.jd,
    skills: JSON.parse(row.skills) as string[],
    targetCompanies: JSON.parse(row.target_companies) as string[],
    notes: row.notes,
    avatarPath: row.avatar_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /UNIQUE constraint failed/i.test(err.message)
}

function toMessage(err: unknown, action: string): string {
  const detail = err instanceof Error ? err.message : String(err)
  return `${action} 失败: ${detail}`
}

/**
 * Service factory — wires the database and config dependencies so handlers
 * can pass them in. Kept as a free function (not a class) so test code
 * can build a fresh service per `it` block without subclassing.
 */
export function createProfileService(db: Database, config: ConfigService): ProfileService {
  return new ProfileService(db, config)
}

/**
 * Pure data layer that mediates between CLI handlers and the `profiles`
 * table. Every public method either returns a `Profile` / `Profile[]` /
 * `Config` or throws a typed `MiError`. Handlers never reach into the
 * SQLite connection directly.
 */
export class ProfileService {
  constructor(
    private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  /**
   * Insert a new profile. The id is a fresh ULID; array fields are
   * JSON-encoded for storage. Defaults are filled by the schema.
   */
  create(input: CreateProfileInput): Profile {
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new MiValidationError(NAME_EMPTY_MESSAGE)
    }

    // The `profiles.name` column is NOT a unique index in the initial
    // schema, so we must pre-check before INSERT. WAL + single-process
    // CLI mean the read-then-write race is not a real concern.
    const existing = this.db.conn
      .query('SELECT id FROM profiles WHERE name = ?')
      .get(input.name) as { id: string } | null
    if (existing) {
      throw new MiValidationError(DUPLICATE_NAME_MESSAGE(input.name))
    }

    const id = ulid()
    const skills = input.skills ?? []
    const targetCompanies = input.targetCompanies ?? []
    const resumeText = input.resumeText ?? ''
    const targetRole = input.targetRole ?? ''
    const jd = input.jd ?? ''
    const notes = input.notes ?? ''
    const resumePath = input.resumePath ?? null
    const avatarPath = input.avatarPath ?? null

    try {
      this.db.conn
        .query(
          `INSERT INTO profiles (
             id, name, resume_text, resume_path, target_role, jd,
             skills, target_companies, notes, avatar_path
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          resumeText,
          resumePath,
          targetRole,
          jd,
          JSON.stringify(skills),
          JSON.stringify(targetCompanies),
          notes,
          avatarPath,
        )
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new MiValidationError(DUPLICATE_NAME_MESSAGE(input.name))
      }
      throw new MiDatabaseError(toMessage(err, 'create profile'))
    }

    const row = this.db.conn
      .query('SELECT * FROM profiles WHERE id = ?')
      .get(id) as ProfileRowRaw | null

    if (!row) {
      throw new MiDatabaseError('create profile: row missing after insert')
    }
    return rowToProfile(row)
  }

  /**
   * Return every profile, ordered by `created_at ASC, id ASC`. JSON
   * array columns are decoded to JS arrays via `rowToProfile`.
   */
  list(): Profile[] {
    const rows = this.db.conn
      .query('SELECT * FROM profiles ORDER BY created_at ASC, id ASC')
      .all() as ProfileRowRaw[]
    return rows.map(rowToProfile)
  }

  /**
   * Look up a single profile by id. Throws `MiValidationError` for
   * empty input and `MiNotFoundError` when no row matches.
   */
  get(id: string): Profile {
    if (typeof id !== 'string' || id.length === 0) {
      throw new MiValidationError('id 不能为空')
    }
    const row = this.db.conn
      .query('SELECT * FROM profiles WHERE id = ?')
      .get(id) as ProfileRowRaw | null
    if (!row) {
      throw new MiNotFoundError(`Profile 不存在: ${id}`)
    }
    return rowToProfile(row)
  }

  /**
   * Apply a partial patch. Empty / missing fields are left untouched.
   * `updated_at` is always refreshed to `datetime('now')` (even for a
   * no-op patch) so downstream code can rely on it as a "last touched"
   * signal. Throws `MiNotFoundError` for unknown ids.
   */
  update(id: string, patch: UpdateProfilePatch): Profile {
    if (typeof id !== 'string' || id.length === 0) {
      throw new MiValidationError('id 不能为空')
    }
    // Pre-check existence so a no-op patch on a missing id still 404s.
    this.get(id)

    const sets: string[] = []
    const params: (string | number | null)[] = []

    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || patch.name.trim().length === 0) {
        throw new MiValidationError('名称不能为空')
      }
      sets.push('name = ?')
      params.push(patch.name)
    }
    if (patch.resumeText !== undefined) {
      sets.push('resume_text = ?')
      params.push(patch.resumeText)
    }
    if (patch.resumePath !== undefined) {
      sets.push('resume_path = ?')
      params.push(patch.resumePath)
    }
    if (patch.targetRole !== undefined) {
      sets.push('target_role = ?')
      params.push(patch.targetRole)
    }
    if (patch.jd !== undefined) {
      sets.push('jd = ?')
      params.push(patch.jd)
    }
    if (patch.skills !== undefined) {
      sets.push('skills = ?')
      params.push(JSON.stringify(patch.skills))
    }
    if (patch.targetCompanies !== undefined) {
      sets.push('target_companies = ?')
      params.push(JSON.stringify(patch.targetCompanies))
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?')
      params.push(patch.notes)
    }
    if (patch.avatarPath !== undefined) {
      sets.push('avatar_path = ?')
      params.push(patch.avatarPath)
    }

    // Always refresh updated_at; even an empty patch bumps the timestamp
    // so clients can rely on it.
    sets.push("updated_at = datetime('now')")

    if (sets.length > 1) {
      params.push(id)
      try {
        this.db.conn.query(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new MiValidationError(DUPLICATE_NAME_MESSAGE(patch.name ?? ''))
        }
        throw new MiDatabaseError(toMessage(err, 'update profile'))
      }
    }

    return this.get(id)
  }

  /**
   * Remove a profile. The `ON DELETE CASCADE` foreign key on
   * `resume_history.profile_id` cleans up the archived snapshots in
   * the same transaction. Throws `MiNotFoundError` when no row with
   * the given id exists.
   */
  delete(id: string): void {
    if (typeof id !== 'string' || id.length === 0) {
      throw new MiValidationError('id 不能为空')
    }
    let changes = 0
    try {
      const result = this.db.conn.query('DELETE FROM profiles WHERE id = ?').run(id)
      changes = result.changes
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, 'delete profile'))
    }
    if (changes === 0) {
      throw new MiNotFoundError(`Profile 不存在: ${id}`)
    }
  }

  /**
   * Persist `id` as the active profile in `config.yml`. Atomic via
   * `ConfigService.save()` (tmp-file rename). Throws `MiNotFoundError`
   * when the profile does not exist; in that case the config is
   * untouched because the existence check happens *before* the write.
   */
  switchActive(id: string): Config {
    if (typeof id !== 'string' || id.length === 0) {
      throw new MiValidationError('id 不能为空')
    }
    // Existence check first so we never write a defaultProfile pointing
    // at a non-existent row.
    this.get(id)

    const current = this.config.load()
    const next: Config = { ...current, defaultProfile: id }
    this.config.save(next)
    return next
  }
}
