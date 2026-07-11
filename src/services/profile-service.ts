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
 * Service factory — wires the database and config dependencies so handlers
 * can pass them in. Kept as a free function (not a class) so test code
 * can build a fresh service per `it` block without subclassing.
 *
 * The class body is populated incrementally as each behavior task lands
 * (T-2 `create`, T-4 `list`, T-5 `get`, T-6 `update`, T-7 `delete`,
 * T-8 `switchActive`).
 */
export function createProfileService(
  // Placeholder signatures so the file type-checks before T-2 lands.
  // Real wiring is introduced in the GREEN commits.
  // biome-ignore lint/correctness/noUnusedParameters: wired in T-2+
  _db: unknown,
  // biome-ignore lint/correctness/noUnusedParameters: wired in T-2+
  _config: unknown,
): ProfileService {
  return new ProfileService()
}

export class ProfileService {
  constructor() {
    // No-arg ctor for now; the GREEN commits add db/config dependencies.
  }
}
