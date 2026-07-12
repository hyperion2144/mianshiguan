// Placeholder test file for the interview service. T-1 only requires
// the skeleton to compile and the factory to wire dependencies; the
// behavioural tests for T-2..T-4 are added in the next waves. This
// file exists so `bun test src/services/__tests__/interview.test.ts`
// resolves a real path even before any test bodies are written.

import { describe, expect, it } from 'vitest'
import { SCORE_DIMENSIONS, createInterviewService, InterviewService } from '../interview.ts'
import { Database } from '../../db/Database.ts'
import { ConfigService } from '../config-service.ts'

describe('InterviewService — skeleton (T-1)', () => {
  it('SCORE_DIMENSIONS contains exactly the five required dimensions in order', () => {
    expect(SCORE_DIMENSIONS).toEqual([
      '技术深度',
      '沟通表达',
      '项目能力',
      '系统思维',
      '岗位匹配度',
    ])
  })

  it('factory returns an InterviewService instance wired with the given deps', () => {
    const db = new Database(':memory:')
    const config = new ConfigService('/tmp/mi-interview-skeleton-test')
    const service = createInterviewService(db, config)
    expect(service).toBeInstanceOf(InterviewService)
    db.close()
  })
})
