import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db/Database.ts'
import type { QuestionCategory, QuestionDifficulty } from '../db/schema.ts'
import { MiNotFoundError, MiValidationError } from '../errors.ts'
import { type QuestionService, createQuestionService } from './question-service.ts'
import type { QuestionImportRecord } from './question-service.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATION_PATH = join(__dirname, '..', 'db', 'migrations', '0003_question_bank.sql')

interface SeedQuestion {
  id: string
  source: string
  sourceId: string
  title: string
  content: string
  difficulty: QuestionDifficulty
  category: QuestionCategory
  tags?: string[]
  createdAt: string
}

function makeDb(): Database {
  const db = new Database(':memory:')
  db.conn.exec(readFileSync(MIGRATION_PATH, 'utf8'))
  return db
}

function seedQuestion(db: Database, question: SeedQuestion): void {
  db.conn
    .query(
      `INSERT INTO questions (
         id, source, source_id, title, content, difficulty, category, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      question.id,
      question.source,
      question.sourceId,
      question.title,
      question.content,
      question.difficulty,
      question.category,
      question.createdAt,
      question.createdAt,
    )

  for (const tagName of question.tags ?? []) {
    const tag = db.conn.query('SELECT id FROM tags WHERE name = ?').get(tagName) as {
      id: string
    } | null
    const tagId = tag?.id ?? `tag-${tagName}`
    if (!tag) {
      db.conn.query('INSERT INTO tags (id, name) VALUES (?, ?)').run(tagId, tagName)
    }
    db.conn
      .query('INSERT INTO question_tags (question_id, tag_id) VALUES (?, ?)')
      .run(question.id, tagId)
  }
}

describe('QuestionService search and list', () => {
  let db: Database
  let service: QuestionService

  beforeEach(() => {
    db = makeDb()
    service = createQuestionService(db)
    seedQuestion(db, {
      id: 'q-early',
      source: 'leetcode',
      sourceId: '1',
      title: 'Two Sum',
      content: 'Find a pair of values',
      difficulty: 'easy',
      category: 'algorithm',
      tags: ['array', 'hash-map'],
      createdAt: '2024-01-01T00:00:00Z',
    })
    seedQuestion(db, {
      id: 'q-late',
      source: 'leetcode',
      sourceId: '2',
      title: 'Hash Table',
      content: 'A TWO SUM variant',
      difficulty: 'easy',
      category: 'algorithm',
      tags: ['array'],
      createdAt: '2024-01-02T00:00:00Z',
    })
    seedQuestion(db, {
      id: 'q-wrong-difficulty',
      source: 'leetcode',
      sourceId: '3',
      title: 'Two Sum Hard',
      content: 'Uses the same phrase',
      difficulty: 'hard',
      category: 'algorithm',
      tags: ['array'],
      createdAt: '2024-01-03T00:00:00Z',
    })
    seedQuestion(db, {
      id: 'q-other-source',
      source: 'nowcoder',
      sourceId: '4',
      title: 'Two Sum Again',
      content: 'A matching question',
      difficulty: 'easy',
      category: 'algorithm',
      tags: ['array'],
      createdAt: '2024-01-04T00:00:00Z',
    })
    seedQuestion(db, {
      id: 'q-no-keyword',
      source: 'leetcode',
      sourceId: '5',
      title: 'Binary Tree',
      content: 'Traverse a tree',
      difficulty: 'easy',
      category: 'system-design',
      tags: ['tree'],
      createdAt: '2024-01-05T00:00:00Z',
    })
  })

  afterEach(() => {
    db.close()
  })

  it('searches title and content case-insensitively and combines filters with AND semantics', () => {
    const results = service.search('TWO SUM', {
      source: 'leetcode',
      difficulty: 'easy',
      category: 'algorithm',
      tag: 'array',
    })

    expect(results.map((question) => question.id)).toEqual(['q-early', 'q-late'])
    expect(results.every((question) => question.tags.includes('array'))).toBe(true)
  })

  it('lists every question in createdAt ASC and id ASC order when unfiltered', () => {
    const results = service.list()

    expect(results.map((question) => question.id)).toEqual([
      'q-early',
      'q-late',
      'q-wrong-difficulty',
      'q-other-source',
      'q-no-keyword',
    ])
  })

  it('rejects an empty or whitespace-only search keyword', () => {
    expect(() => service.search('   ')).toThrowError(MiValidationError)
    expect(() => service.search('')).toThrowError(/不能为空/)
  })
  it('retrieves complete details with decoded arrays and normalized tags', () => {
    seedQuestion(db, {
      id: 'q-detail',
      source: 'company',
      sourceId: 'detail-1',
      title: 'Design a queue',
      content: 'Explain queue trade-offs',
      difficulty: 'medium',
      category: 'system-design',
      tags: ['distributed', 'queue'],
      createdAt: '2024-02-01T00:00:00Z',
    })
    db.conn
      .query(
        `UPDATE questions
         SET url = ?, reference_answer = ?, explanation = ?, knowledge_points = ?, test_cases = ?
         WHERE id = ?`,
      )
      .run(
        'https://example.test/queue',
        'Use a broker with backpressure',
        'Discuss ordering and retries',
        JSON.stringify(['backpressure', 'ordering']),
        JSON.stringify([
          { input: 'a', output: 'b' },
          { input: 'c', output: 'd' },
        ]),
        'q-detail',
      )

    const result = service.get('q-detail')

    expect(result).toMatchObject({
      id: 'q-detail',
      source: 'company',
      sourceId: 'detail-1',
      title: 'Design a queue',
      content: 'Explain queue trade-offs',
      difficulty: 'medium',
      category: 'system-design',
      tags: ['distributed', 'queue'],
      url: 'https://example.test/queue',
      referenceAnswer: 'Use a broker with backpressure',
      explanation: 'Discuss ordering and retries',
      knowledgePoints: ['backpressure', 'ordering'],
      testCases: [
        { input: 'a', output: 'b' },
        { input: 'c', output: 'd' },
      ],
      createdAt: '2024-02-01T00:00:00Z',
      updatedAt: '2024-02-01T00:00:00Z',
    })
  })

  it('rejects an empty ID and reports an unknown ID as not found', () => {
    expect(() => service.get('   ')).toThrowError(MiValidationError)
    expect(() => service.get('missing-question')).toThrowError(MiNotFoundError)
  })
  it('imports equivalent JSON and YAML batches with documented defaults', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mi-question-import-'))
    const jsonPath = join(tempDir, 'questions.json')
    const yamlPath = join(tempDir, 'questions.yaml')
    const records = [
      {
        source: 'import-bank',
        sourceId: '1',
        title: 'Imported array question',
        content: 'Find an item in an array',
        difficulty: 'easy',
        category: 'algorithm',
        tags: ['array'],
        url: 'https://example.test/array',
        referenceAnswer: 'Scan the array',
        explanation: 'A linear scan is sufficient',
        knowledgePoints: ['arrays'],
        testCases: [{ input: '[1]', output: '1' }],
      },
      {
        source: 'import-bank',
        sourceId: '2',
        title: 'Imported design question',
        content: 'Describe a cache',
        difficulty: 'medium',
        category: 'system-design',
      },
    ]
    writeFileSync(jsonPath, JSON.stringify(records), 'utf8')
    writeFileSync(
      yamlPath,
      `- source: import-bank
  sourceId: '1'
  title: Imported array question
  content: Find an item in an array
  difficulty: easy
  category: algorithm
  tags:
    - array
  url: https://example.test/array
  referenceAnswer: Scan the array
  explanation: A linear scan is sufficient
  knowledgePoints:
    - arrays
  testCases:
    - input: '[1]'
      output: '1'
- source: import-bank
  sourceId: '2'
  title: Imported design question
  content: Describe a cache
  difficulty: medium
  category: system-design
`,
      'utf8',
    )

    const jsonResult = service.importFile(jsonPath)
    const jsonQuestions = service.list({ source: 'import-bank' })

    const yamlDb = makeDb()
    const yamlService = createQuestionService(yamlDb)
    try {
      const yamlResult = yamlService.importFile(yamlPath)
      const yamlQuestions = yamlService.list({ source: 'import-bank' })

      expect(jsonResult).toMatchObject({ imported: 2, skipped: 0 })
      expect(jsonResult.ids).toHaveLength(2)
      expect(yamlResult).toMatchObject({ imported: 2, skipped: 0 })
      expect(yamlResult.ids).toHaveLength(2)
      const comparableJson = jsonQuestions
        .map(({ id, createdAt, updatedAt, ...question }) => question)
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
      const comparableYaml = yamlQuestions
        .map(({ id, createdAt, updatedAt, ...question }) => question)
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
      expect(comparableJson).toEqual(comparableYaml)
      expect(jsonQuestions.find((question) => question.sourceId === '2')).toMatchObject({
        tags: [],
        url: null,
        referenceAnswer: '',
        explanation: '',
        knowledgePoints: [],
        testCases: [],
      })
    } finally {
      yamlDb.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
  it('rejects invalid imports before writing any question, tag, or link', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mi-question-invalid-'))
    const path = join(tempDir, 'invalid.json')
    const counts = (): Record<string, number> => ({
      questions: (
        db.conn.query('SELECT COUNT(*) AS count FROM questions').get() as { count: number }
      ).count,
      tags: (db.conn.query('SELECT COUNT(*) AS count FROM tags').get() as { count: number }).count,
      links: (
        db.conn.query('SELECT COUNT(*) AS count FROM question_tags').get() as { count: number }
      ).count,
    })
    const before = counts()
    const valid = {
      source: 'atomic-bank',
      sourceId: 'valid',
      title: 'Valid record',
      content: 'Should roll back',
      difficulty: 'easy',
      category: 'algorithm',
      tags: ['atomic-tag'],
    }
    const expectValidation = (content: string): void => {
      writeFileSync(path, content, 'utf8')
      expect(() => service.importFile(path)).toThrowError(MiValidationError)
      expect(counts()).toEqual(before)
    }

    try {
      expectValidation(
        JSON.stringify([valid, { ...valid, sourceId: 'invalid', category: 'other' }]),
      )
      expectValidation('[')
      expectValidation('- source: [')
      expectValidation(JSON.stringify({ source: 'not-an-array' }))
      expectValidation(JSON.stringify([{ ...valid, title: '   ' }]))
      expectValidation(JSON.stringify([{ ...valid, difficulty: 'expert' }]))
      expectValidation(JSON.stringify([{ ...valid, tags: ['ok', 1] }]))
      expectValidation(JSON.stringify([{ ...valid, knowledgePoints: 'not-an-array' }]))
      expectValidation(JSON.stringify([{ ...valid, testCases: 'not-an-array' }]))

      const unsupportedPath = join(tempDir, 'invalid.txt')
      writeFileSync(unsupportedPath, '[]', 'utf8')
      expect(() => service.importFile(unsupportedPath)).toThrowError(MiValidationError)
      expect(counts()).toEqual(before)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
  it('skips existing and repeated source identities without duplicate links', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mi-question-dedupe-'))
    const path = join(tempDir, 'duplicates.json')
    writeFileSync(
      path,
      JSON.stringify([
        {
          source: 'leetcode',
          sourceId: '1',
          title: 'Changed duplicate',
          content: 'Must not overwrite',
          difficulty: 'hard',
          category: 'behavioral',
          tags: ['existing-only'],
        },
        {
          source: 'leetcode',
          sourceId: '1',
          title: 'Repeated duplicate',
          content: 'Must also be skipped',
          difficulty: 'easy',
          category: 'algorithm',
          tags: ['existing-only'],
        },
        {
          source: 'leetcode',
          sourceId: 'new-1',
          title: 'New question',
          content: 'Should be inserted once',
          difficulty: 'easy',
          category: 'algorithm',
          tags: ['array', 'new-tag'],
        },
      ]),
      'utf8',
    )

    try {
      const result = service.importFile(path)

      expect(result.imported).toBe(1)
      expect(result.skipped).toBe(2)
      expect(result.ids).toHaveLength(1)
      expect(db.conn.query('SELECT COUNT(*) AS count FROM questions').get()).toEqual({ count: 6 })
      expect(
        db.conn.query("SELECT COUNT(*) AS count FROM tags WHERE name = 'existing-only'").get(),
      ).toEqual({ count: 0 })
      expect(
        db.conn.query("SELECT COUNT(*) AS count FROM tags WHERE name = 'new-tag'").get(),
      ).toEqual({ count: 1 })
      expect(
        db.conn
          .query("SELECT COUNT(*) AS count FROM question_tags WHERE question_id = 'q-early'")
          .get(),
      ).toEqual({ count: 2 })
      expect(service.get('q-early')).toMatchObject({
        title: 'Two Sum',
        content: 'Find a pair of values',
        tags: ['array', 'hash-map'],
      })
      expect(service.get(result.ids[0]!)).toMatchObject({
        source: 'leetcode',
        sourceId: 'new-1',
        tags: ['array', 'new-tag'],
      })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('QuestionService.importRecords', () => {
  let db: Database
  let service: QuestionService

  beforeEach(() => {
    db = makeDb()
    service = createQuestionService(db)
  })

  afterEach(() => {
    db.close()
  })

  function rowCount(sql: string): number {
    const row: unknown = db.conn.query(sql).get()
    if (row !== null && typeof row === 'object' && 'count' in row) {
      const value = row.count
      if (typeof value === 'number') return value
    }
    return 0
  }

  function rowCounts(): { questions: number; tags: number; links: number } {
    return {
      questions: rowCount('SELECT COUNT(*) AS count FROM questions'),
      tags: rowCount('SELECT COUNT(*) AS count FROM tags'),
      links: rowCount('SELECT COUNT(*) AS count FROM question_tags'),
    }
  }

  function makeRecord(overrides: Partial<QuestionImportRecord> = {}): QuestionImportRecord {
    return {
      source: 'leetcode',
      sourceId: '1',
      title: 'Default title',
      content: 'Default content body',
      difficulty: 'easy',
      category: 'algorithm',
      tags: ['array'],
      ...overrides,
    }
  }

  it('persists validated records and dedups existing + repeated source identities (T-10)', () => {
    const recordA = makeRecord({ sourceId: '101', title: 'A record', tags: ['array', 'new-tag'] })
    const recordB = makeRecord({ sourceId: '102', title: 'B record', tags: ['array'] })
    const duplicate = makeRecord({ sourceId: '101', title: 'Duplicate of A', tags: ['array'] })

    const result = service.importRecords([recordA, recordB, duplicate])

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.ids).toHaveLength(2)
    const persisted = service.list({ source: 'leetcode' })
    expect(persisted).toHaveLength(2)
    expect(persisted.map((question) => question.sourceId).sort()).toEqual(['101', '102'])
    expect(persisted.find((question) => question.sourceId === '101')?.title).toBe('A record')
    expect(persisted.every((question) => question.tags.includes('array'))).toBe(true)
  })

  it('rolls back the batch when any record fails validation (T-11)', () => {
    const valid = makeRecord({ sourceId: 'valid-1', title: 'Valid record' })
    const invalidCategory = {
      ...makeRecord({ sourceId: 'invalid-1', title: 'Invalid category' }),
      category: 'other',
    } as unknown as QuestionImportRecord

    const before = rowCounts()
    expect(() => service.importRecords([valid, invalidCategory])).toThrowError(MiValidationError)
    expect(rowCounts()).toEqual(before)
    expect(service.list({})).toEqual([])
    expect(rowCount('SELECT COUNT(*) AS count FROM tags')).toBe(0)
    expect(rowCount('SELECT COUNT(*) AS count FROM question_tags')).toBe(0)
  })
})
