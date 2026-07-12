# Fix Tasks: interview-core

> Fix tasks for review findings. Organised by severity: BLOCKER/FAIL first.

---

## Wave 1: BLOCKER + FAIL + MAJOR (must fix)

- [x] T-1: [type:docs] Create global spec `bp/specs/interview/spec.md` from delta-spec <!-- commit: 1d21eda -->
  - **refs**: DS-1, DS-2
  - **files**: bp/specs/interview/spec.md
  - **spec_ref**: spec-review.md#R20
  - **acceptance**: bp/specs/interview/spec.md exists with all 16 requirements from delta-spec, ADDED/MODIFIED/REMOVED sections, and no template placeholders. All SHALL/MUST statements match the implementation.

- [x] T-2: [type:behavior] Reject invalid `--style` values with MiValidationError <!-- commit: 2fe25e6 -->
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/__tests__/interview.test.ts
  - **spec_ref**: spec-review.md#R19
  - **acceptance**: `--style rude` throws MiValidationError with Chinese message like `--style 必须是 coaching / strict / friendly`. Tests for invalid, valid, and default.
  - ***RED test***:
    ```
    GIVEN an active profile
    WHEN mi interview start --role FE --style rude
    THEN MiValidationError thrown with Chinese message listing valid styles
    WHEN mi interview start --role FE --style coaching
    THEN succeeds
    ```

- [x] T-3: [type:refactor] Fix TRANSITIONS.paused to remove stale 'completed' entry <!-- commit: 955dc76 -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts
  - **spec_ref**: spec-review.md#R21
  - **acceptance**: TRANSITIONS.paused only lists `['in_progress']`. The complete() method still requires from: 'in_progress'. All state machine tests still pass.

## Wave 2: MINOR (should fix)

- [x] T-4: [type:refactor] Optimize findPausedInterview to use service-level query instead of loading all <!-- commit: 1994b99 -->
  - **refs**: DS-2
  - **files**: src/commands/interview.ts
  - **spec_ref**: quality-review.md#Q3
  - **acceptance**: resume command queries only paused interviews instead of loading all. No functional change.

## Wave 3: INFO (could fix)

- [x] T-5: [type:refactor] Add scores re-validation in computeAggregateScores <!-- commit: 2530637 -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts
  - **spec_ref**: quality-review.md#Q5
  - **acceptance**: safeParseScores result validated for 5-dim 1-10 contract. Tests pass.

- [x] T-6: [type:behavior] Validate non-empty questionText/answerText in recordAnswer <!-- commit: 4892129 -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts, src/services/__tests__/interview.test.ts
  - **spec_ref**: quality-review.md#Q6
  - **acceptance**: empty questionText or answerText throws MiValidationError. Tests pass.

---

## Implementation Verification

- [ ] `bun run tsc --noEmit` passes
- [ ] `bun test` all suites pass
