# Tasks: skill-templates

> Single wave — the renderer is a pure-string module; no layer dependencies.
> Each task is one independently testable behavior path of `src/skill-templates/interview.ts`.
> Order: scaffold → validation → shared body → style branching → three wrappers → dispatch + golden snapshots.

---

## TDD Type Annotations

| type | Meaning | TDD Protocol |
|------|---------|-------------|
| `behavior` | Business behavior — implement a concrete, observable/assertable feature | **RED→GREEN→REFACTOR** (mandatory: test first → implement → refactor) |
| `config` | Configuration — env vars, CI/CD, lint, tsconfig, etc. | Direct implementation, no TDD |
| `refactor` | Refactoring — improve internal structure without changing behavior | Verify tests pass → refactor → verify again |
| `docs` | Documentation — README, API docs, comments | Direct implementation, no TDD |
| `scaffolding` | Skeleton code — new module shells, directory structure, templates | Direct implementation, no TDD |

> **Rule**: If a task's core output is "a behavior" (user-perceptible or test-assertable), use `behavior`. If it's just "file exists" or "config takes effect", use `config`/`scaffolding`.

---

## Wave 1: skill-templates renderer

- [x] T-1: [type:scaffolding] Scaffold skill-templates module skeleton <!-- commit: c041bfc -->
  - **refs**: DS-1
  - **files**: src/skill-templates/interview.ts, src/skill-templates/__tests__/interview.test.ts
  - **acceptance**: `src/skill-templates/` directory exists; `src/skill-templates/__tests__/` exists for co-located tests (mirrors src/services pattern); `src/skill-templates/interview.ts` exports `VALID_PLATFORMS`, `VALID_STYLES`,      `DEFAULT_DIMENSIONS`, `DEFAULT_LANGUAGE`, `Platform`,
      `InterviewerStyle`, `InterviewSkillConfig` types/constants
    - `src/skill-templates/__tests__/interview.test.ts` imports the module without TypeScript errors
    - `bun run typecheck` passes
  - **depends_on**: []
- [x] T-2: [type:behavior] `validateConfig()` rejects invalid platform and interviewer style <!-- commit: 04abd67 -->
  - **refs**: DS-1
  - **files**: src/skill-templates/interview.ts, src/skill-templates/__tests__/interview.test.ts
  - **spec_ref**: specs/skill-templates/spec.md
  - **acceptance**: Calling `renderInterviewSkill({ platform: 'unknown', interviewerStyle: 'coaching' })`      throws `MiValidationError` with Chinese message containing
      `无效的平台: unknown (合法: omp, claude-code, opencode)`
    - Calling with `interviewerStyle: 'casual'` throws with Chinese message
      containing `无效的面试官风格: casual (合法: strict, coaching, friendly)`
    - Calling with a valid platform + style returns a non-empty string
    - `validateConfig` is exported for direct unit testing
  - **RED test**:
    ```
    GIVEN an InterviewSkillConfig with platform = 'unknown'
    WHEN renderInterviewSkill(config) is called
    THEN it throws MiValidationError and the message starts with "无效的平台"
    ```
- [x] T-3: [type:behavior] `buildPromptBody()` returns shared prompt body with role + CLI + scoring <!-- commit: f531ddd -->
  - **refs**: DS-1
  - **files**: src/skill-templates/interview.ts, src/skill-templates/__tests__/interview.test.ts
  - **spec_ref**: specs/skill-templates/spec.md
  - **acceptance**: Output is a non-empty UTF-8 string ≤ 8 KB; Output contains role definition (`你是一位专业的技术面试官`); Output contains 5-dimension scoring rubric header; Output contains each of the seven CLI commands from `proposal.md`:      `mi interview start`, `mi interview status`, `mi interview pause`,
      `mi interview resume`, `mi interview list`, `mi interview score`,
      `mi interview report`
    - Output contains a profile + resume context block (or marked "未指定"
      when `defaultProfile` / `targetRole` are omitted)
    - Output contains semi-free conversation flow guidance from D-3
      (mentions `自然地推进面试`, `每题后给出简要反馈`)
    - Function is exported and deterministic (same config → byte-identical)
  - **RED test**:
    ```
    GIVEN a valid InterviewSkillConfig
    WHEN buildPromptBody(config) is called
    THEN the returned string contains "你是一位专业的技术面试官" and "mi interview start"
    ```
- [x] T-4: [type:behavior] `buildPromptBody()` style-specific guidance branches per interviewerStyle <!-- commit: b8f4758 -->
  - **refs**: DS-1
  - **files**: src/skill-templates/interview.ts, src/skill-templates/__tests__/interview.test.ts
  - **spec_ref**: specs/skill-templates/spec.md
  - **acceptance**: `interviewerStyle: 'strict'` → output contains `严格` and tense      critical-evaluation guidance (e.g. "严厉指出错误", "不能放过模糊表述")
    - `interviewerStyle: 'coaching'` → output contains `引导` and Socratic
      question guidance (e.g. "通过反问引导候选人思考")
    - `interviewerStyle: 'friendly'` → output contains `友好` and
      encouraging guidance (e.g. "鼓励候选人", "先肯定再建议")
    - Each style branch is mutually exclusive — switching styles changes
      the guidance block but leaves role / CLI / scoring rubric intact
    - Style choice does not require platform (test by passing only body
      args; same style guidance visible across all 3 platforms)
  - **RED test**:
    ```
    GIVEN config with interviewerStyle = 'coaching'
    WHEN buildPromptBody(config) is called
    THEN output contains "引导" and the substring "通过反问"
    ```
- [x] T-5: [type:behavior] `wrapForOmp()` produces omp skill YAML frontmatter + render dispatch <!-- commit: e06bea6 -->
  - **refs**: DS-2
  - **files**: src/skill-templates/interview.ts, src/skill-templates/__tests__/interview.test.ts
  - **spec_ref**: specs/skill-templates/spec.md
  - **acceptance**: `wrapForOmp(body, config)` returns a string that begins with `---\n`; Output contains `name: mianshiguan-interview`, `description:`,      `triggers:`, and `version:` keys in the YAML frontmatter
    - Frontmatter closes with `---\n` before the body content
    - The body is preserved verbatim after the frontmatter
    - `renderInterviewSkill({ platform: 'omp', ... })` returns the
      `wrapForOmp`-shaped output (dispatch path works end-to-end)
    - Output ends with `<!-- mianshiguan:omp v<MI_VERSION> -->` version marker
  - **RED test**:
    ```
    GIVEN config with platform = 'omp'
    WHEN renderInterviewSkill(config) is called
    THEN output begins with "---\nname: mianshiguan-interview"
    ```
- [x] T-6: [type:behavior] `wrapForClaudeCode()` produces /mianshi slash command markdown + render dispatch <!-- commit: 9f431f9 -->
  - **refs**: DS-2
  - **files**: src/skill-templates/interview.ts, src/skill-templates/__tests__/interview.test.ts
  - **spec_ref**: specs/skill-templates/spec.md
  - **acceptance**: `wrapForClaudeCode(body, config)` returns a string that begins      with Claude-code slash-command frontmatter (`---`) with `description:`
      and `argument-hint:` keys
    - Output contains the `/mianshi` invocation string
    - The body is preserved verbatim after the frontmatter
    - `renderInterviewSkill({ platform: 'claude-code', ... })` returns
      the `wrapForClaudeCode`-shaped output (dispatch path works)
    - Output ends with `<!-- mianshiguan:claude-code v<MI_VERSION> -->` version marker
  - **RED test**:
    ```
    GIVEN config with platform = 'claude-code'
    WHEN renderInterviewSkill(config) is called
    THEN output contains "/mianshi" and the substring "argument-hint:"
    ```
- [x] T-7: [type:behavior] `wrapForOpencode()` produces agent definition block + render dispatch <!-- commit: 25ef97b -->
  - **refs**: DS-2
  - **files**: src/skill-templates/interview.ts, src/skill-templates/__tests__/interview.test.ts
  - **spec_ref**: specs/skill-templates/spec.md
  - **acceptance**: `wrapForOpencode(body, config)` returns a string that begins      with an opencode agent definition block
    - Output contains `name: mianshiguan-interviewer`, `description:`,
      and tool-permission keys (`tools:`, `allowed_commands:`)
    - The body is embedded in a `prompt:` field
    - `renderInterviewSkill({ platform: 'opencode', ... })` returns the
      `wrapForOpencode`-shaped output (dispatch path works)
    - Output ends with `<!-- mianshiguan:opencode v<MI_VERSION> -->` version marker
  - **RED test**:
    ```
    GIVEN config with platform = 'opencode'
    WHEN renderInterviewSkill(config) is called
    THEN output contains "name: mianshiguan-interviewer" and "tools:"
    ```
- [x] T-8: [type:behavior] Golden file snapshot for all 3 platforms with same config <!-- commit: ea91d2e -->
  - **refs**: DS-2
  - **files**: src/skill-templates/interview.ts, src/skill-templates/__tests__/interview.test.ts
  - **spec_ref**: specs/skill-templates/spec.md
  - **acceptance**: A canonical `BASE_CONFIG` is defined in the test file:      platform loops over `omp`, `claude-code`, `opencode`;
      interviewerStyle = `'coaching'`; dimensions omitted (default);
      defaultProfile + targetRole populated
    - For each platform, `renderInterviewSkill(BASE_CONFIG)` output is
      compared against a committed `expect.stringContaining` snapshot
      (golden file in `__snapshots__/interview.test.ts.snap` via vitest)
    - All three snapshots co-exist and are individually tested
    - Switching style to `'strict'` and `'friendly'` produces
      distinguishable snapshots (different style block)
    - Snapshot files are committed (CI fails on drift)
    - `bun test src/skill-templates` passes
  - **RED test**:
    ```
    GIVEN a canonical BASE_CONFIG and platform = 'omp'
    WHEN renderInterviewSkill(BASE_CONFIG) is called for the first time
    THEN it writes the rendered output as a snapshot named "omp-default-coaching"
    ```

---

## Implementation Verification

> **This is NOT the review step.** These checks confirm the code is correct and tests pass. After passing, run `bp continue` to advance to the review/archive workflow step.

- [x] `bun run typecheck` passes
- [x] `bun test src/skill-templates` passes — 47 pass / 0 fail
- [x] Each task's `acceptance` confirmed by running its test
- [x] No new lint warnings
- [x] No `any` introduced
- [x] Golden-file snapshot committed
