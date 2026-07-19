import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import yaml from 'js-yaml'
import { ulid } from 'ulid'

import { Database } from '../db/Database.ts'
import type {
  QuestionCategory,
  QuestionDifficulty,
} from '../db/schema.ts'
import { MiDatabaseError, MiNotFoundError, MiValidationError } from '../errors.ts'

export type { QuestionCategory, QuestionDifficulty } from '../db/schema.ts'

export interface Question {
  id: string
  source: string
  sourceId: string
  title: string
  content: string
  difficulty: QuestionDifficulty
  category: QuestionCategory
  tags: string[]
  url: string | null
  referenceAnswer: string
  explanation: string
  knowledgePoints: string[]
  testCases: unknown[]
  createdAt: string
  updatedAt: string
}

export interface QuestionFilters {
  source?: string
  difficulty?: QuestionDifficulty
  category?: QuestionCategory
  tag?: string
}

export interface QuestionImportRecord {
  source: string
  sourceId: string
  title: string
  content: string
  difficulty: QuestionDifficulty
  category: QuestionCategory
  tags?: string[]
  url?: string | null
  referenceAnswer?: string
  explanation?: string
  knowledgePoints?: string[]
  testCases?: unknown[]
}

export interface QuestionImportResult {
  imported: number
  skipped: number
  ids: string[]
}

interface QuestionRowRaw {
  id: string
  source: string
  source_id: string
  title: string
  content: string
  difficulty: QuestionDifficulty
  category: QuestionCategory
  url: string | null
  reference_answer: string
  explanation: string
  knowledge_points: string
  test_cases: string
  created_at: string
  updated_at: string
}

interface QuestionTagNameRow {
  question_id: string
  name: string
}

interface SourceIdentityRow {
  source: string
  source_id: string
}

const QUESTION_CATEGORIES: readonly QuestionCategory[] = [
  'algorithm',
  'system-design',
  'behavioral',
]
const QUESTION_DIFFICULTIES: readonly QuestionDifficulty[] = ['easy', 'medium', 'hard']

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function rowToQuestion(row: QuestionRowRaw, tags: string[]): Question {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    title: row.title,
    content: row.content,
    difficulty: row.difficulty,
    category: row.category,
    tags,
    url: row.url,
    referenceAnswer: row.reference_answer,
    explanation: row.explanation,
    knowledgePoints: parseJsonArray<string>(row.knowledge_points),
    testCases: parseJsonArray<unknown>(row.test_cases),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateFilters(filters: QuestionFilters | undefined): void {
  if (filters === undefined) return
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new MiValidationError('筛选条件格式错误')
  }
  if (
    filters.source !== undefined &&
    (typeof filters.source !== 'string' || filters.source.trim().length === 0)
  ) {
    throw new MiValidationError('source 不能为空')
  }
  if (
    filters.difficulty !== undefined &&
    !QUESTION_DIFFICULTIES.includes(filters.difficulty as QuestionDifficulty)
  ) {
    throw new MiValidationError(`difficulty 无效: ${String(filters.difficulty)}`)
  }
  if (
    filters.category !== undefined &&
    !QUESTION_CATEGORIES.includes(filters.category as QuestionCategory)
  ) {
    throw new MiValidationError(`category 无效: ${String(filters.category)}`)
  }
  if (
    filters.tag !== undefined &&
    (typeof filters.tag !== 'string' || filters.tag.trim().length === 0)
  ) {
    throw new MiValidationError('tag 不能为空')
  }
}

function databaseErrorMessage(err: unknown, action: string): string {
  const detail = err instanceof Error ? err.message : String(err)
  return `${action} 失败: ${detail}`
}
interface NormalizedQuestionImportRecord {
  source: string
  sourceId: string
  title: string
  content: string
  difficulty: QuestionDifficulty
  category: QuestionCategory
  tags: string[]
  url: string | null
  referenceAnswer: string
  explanation: string
  knowledgePoints: string[]
  testCases: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredImportString(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MiValidationError(`第 ${index + 1} 条记录的 ${field} 不能为空`)
  }
  return value.trim()
}

function optionalImportText(value: unknown, field: string, index: number): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    throw new MiValidationError(`第 ${index + 1} 条记录的 ${field} 必须是字符串`)
  }
  return value
}

function optionalImportStringArray(value: unknown, field: string, index: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new MiValidationError(`第 ${index + 1} 条记录的 ${field} 必须是字符串数组`)
  }
  const values: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new MiValidationError(`第 ${index + 1} 条记录的 ${field} 必须是字符串数组`)
    }
    values.push(item)
  }
  return values
}

function importTags(value: unknown, index: number): string[] {
  const tags = optionalImportStringArray(value, 'tags', index).map((tag) => tag.trim())
  if (tags.some((tag) => tag.length === 0)) {
    throw new MiValidationError(`第 ${index + 1} 条记录的 tags 不能包含空字符串`)
  }
  return [...new Set(tags)]
}

function optionalImportArray(value: unknown, field: string, index: number): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new MiValidationError(`第 ${index + 1} 条记录的 ${field} 必须是数组`)
  }
  return value
}

function normalizeImportRecord(value: unknown, index: number): NormalizedQuestionImportRecord {
  if (!isRecord(value)) {
    throw new MiValidationError(`第 ${index + 1} 条记录格式错误`)
  }
  const difficulty = requiredImportString(value.difficulty, 'difficulty', index)
  const category = requiredImportString(value.category, 'category', index)
  if (!QUESTION_DIFFICULTIES.includes(difficulty as QuestionDifficulty)) {
    throw new MiValidationError(`第 ${index + 1} 条记录的 difficulty 无效: ${difficulty}`)
  }
  if (!QUESTION_CATEGORIES.includes(category as QuestionCategory)) {
    throw new MiValidationError(`第 ${index + 1} 条记录的 category 无效: ${category}`)
  }
  const url = value.url === undefined || value.url === null ? null : value.url
  if (url !== null && typeof url !== 'string') {
    throw new MiValidationError(`第 ${index + 1} 条记录的 url 必须是字符串或 null`)
  }
  return {
    source: requiredImportString(value.source, 'source', index),
    sourceId: requiredImportString(value.sourceId, 'sourceId', index),
    title: requiredImportString(value.title, 'title', index),
    content: requiredImportString(value.content, 'content', index),
    difficulty: difficulty as QuestionDifficulty,
    category: category as QuestionCategory,
    tags: importTags(value.tags, index),
    url,
    referenceAnswer: optionalImportText(value.referenceAnswer, 'referenceAnswer', index),
    explanation: optionalImportText(value.explanation, 'explanation', index),
    knowledgePoints: optionalImportStringArray(value.knowledgePoints, 'knowledgePoints', index),
    testCases: optionalImportArray(value.testCases, 'testCases', index),
  }
}

function decodeAndValidateImportFile(filePath: string): NormalizedQuestionImportRecord[] {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new MiValidationError('导入文件路径不能为空')
  }
  const extension = extname(filePath).toLowerCase()
  if (extension !== '.json' && extension !== '.yaml' && extension !== '.yml') {
    throw new MiValidationError(`不支持的导入文件格式: ${extension || '未知'}`)
  }
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new MiValidationError(`读取导入文件失败: ${detail}`)
  }
  let parsed: unknown
  try {
    parsed = extension === '.json' ? JSON.parse(text) : yaml.load(text)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new MiValidationError(`导入文件解析失败: ${detail}`)
  }
  if (!Array.isArray(parsed)) {
    throw new MiValidationError('导入文件顶层必须是数组')
  }
  return parsed.map((record, index) => normalizeImportRecord(record, index))
}


function sourceIdentityKey(source: string, sourceId: string): string {
  return JSON.stringify([source, sourceId])
}

export class QuestionService {
  constructor(private readonly db: Database) {}

  search(keyword: string, filters?: QuestionFilters): Question[] {
    if (typeof keyword !== 'string' || keyword.trim().length === 0) {
      throw new MiValidationError('搜索关键词不能为空')
    }
    validateFilters(filters)
    return this.queryQuestions(keyword.trim(), filters)
  }

  list(filters?: QuestionFilters): Question[] {
    validateFilters(filters)
    return this.queryQuestions(undefined, filters)
  }

  private queryQuestions(keyword: string | undefined, filters?: QuestionFilters): Question[] {
    const conditions: string[] = []
    const params: string[] = []

    if (keyword !== undefined) {
      conditions.push('(instr(lower(q.title), lower(?)) > 0 OR instr(lower(q.content), lower(?)) > 0)')
      params.push(keyword, keyword)
    }
    if (filters?.source !== undefined) {
      conditions.push('q.source = ?')
      params.push(filters.source.trim())
    }
    if (filters?.difficulty !== undefined) {
      conditions.push('q.difficulty = ?')
      params.push(filters.difficulty)
    }
    if (filters?.category !== undefined) {
      conditions.push('q.category = ?')
      params.push(filters.category)
    }
    if (filters?.tag !== undefined) {
      conditions.push(
        `EXISTS (
           SELECT 1
           FROM question_tags qtf
           JOIN tags tf ON tf.id = qtf.tag_id
           WHERE qtf.question_id = q.id AND tf.name = ?
         )`,
      )
      params.push(filters.tag.trim())
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    let rows: QuestionRowRaw[]
    try {
      rows = this.db.conn
        .query(
          `SELECT q.*
           FROM questions q
           ${where}
           ORDER BY q.created_at ASC, q.id ASC`,
        )
        .all(...params) as QuestionRowRaw[]
    } catch (err) {
      throw new MiDatabaseError(databaseErrorMessage(err, '查询题目'))
    }
    return this.withTags(rows)
  }

  private withTags(rows: QuestionRowRaw[]): Question[] {
    if (rows.length === 0) return []
    const placeholders = rows.map(() => '?').join(', ')
    const ids = rows.map((row) => row.id)
    let tagRows: QuestionTagNameRow[]
    try {
      tagRows = this.db.conn
        .query(
          `SELECT qt.question_id, t.name
           FROM question_tags qt
           JOIN tags t ON t.id = qt.tag_id
           WHERE qt.question_id IN (${placeholders})
           ORDER BY qt.question_id ASC, t.name ASC`,
        )
        .all(...ids) as QuestionTagNameRow[]
    } catch (err) {
      throw new MiDatabaseError(databaseErrorMessage(err, '查询题目标签'))
    }
    const tagsByQuestion = new Map<string, string[]>()
    for (const tagRow of tagRows) {
      const tags = tagsByQuestion.get(tagRow.question_id) ?? []
      tags.push(tagRow.name)
      tagsByQuestion.set(tagRow.question_id, tags)
    }
    return rows.map((row) => rowToQuestion(row, tagsByQuestion.get(row.id) ?? []))
  }

  get(id: string): Question {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new MiValidationError('id 不能为空')
    }
    let row: QuestionRowRaw | null
    try {
      row = this.db.conn.query('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRowRaw | null
    } catch (err) {
      throw new MiDatabaseError(databaseErrorMessage(err, '查询题目详情'))
    }
    if (!row) {
      throw new MiNotFoundError(`Question 不存在: ${id}`)
    }
    const [question] = this.withTags([row])
    if (!question) {
      throw new MiDatabaseError('查询题目详情失败: row missing after query')
    }
    return question
  }


  importFile(filePath: string): QuestionImportResult {
    const records = decodeAndValidateImportFile(filePath)
    try {
      return this.persistImportRecords(records)
    } catch (err) {
      if (err instanceof MiValidationError) throw err
      throw new MiDatabaseError(databaseErrorMessage(err, '导入题目'))
    }
  }

  private persistImportRecords(records: NormalizedQuestionImportRecord[]): QuestionImportResult {
    const persist = this.db.conn.transaction(() => {
      const ids: string[] = []
      let skipped = 0
      const existingRows = this.db.conn
        .query('SELECT source, source_id FROM questions')
        .all() as SourceIdentityRow[]
      const existingKeys = new Set(
        existingRows.map((row) => sourceIdentityKey(row.source, row.source_id)),
      )
      const insertQuestion = this.db.conn.query(
        `INSERT INTO questions (
           id, source, source_id, title, content, difficulty, category, url,
           reference_answer, explanation, knowledge_points, test_cases
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const findTag = this.db.conn.query('SELECT id FROM tags WHERE name = ?')
      const insertTag = this.db.conn.query('INSERT INTO tags (id, name) VALUES (?, ?)')
      const insertQuestionTag = this.db.conn.query(
        'INSERT INTO question_tags (question_id, tag_id) VALUES (?, ?)',
      )

      for (const record of records) {
        const key = sourceIdentityKey(record.source, record.sourceId)
        if (existingKeys.has(key)) {
          skipped += 1
          continue
        }
        const id = ulid()
        insertQuestion.run(
          id,
          record.source,
          record.sourceId,
          record.title,
          record.content,
          record.difficulty,
          record.category,
          record.url,
          record.referenceAnswer,
          record.explanation,
          JSON.stringify(record.knowledgePoints),
          JSON.stringify(record.testCases),
        )
        for (const tagName of record.tags) {
          const existingTag = findTag.get(tagName) as { id: string } | null
          const tagId = existingTag?.id ?? ulid()
          if (!existingTag) insertTag.run(tagId, tagName)
          insertQuestionTag.run(id, tagId)
        }
        existingKeys.add(key)
        ids.push(id)
      }
      return { imported: ids.length, skipped, ids }
    })
    return persist()
  }

}

export function createQuestionService(db: Database): QuestionService {
  return new QuestionService(db)
}
