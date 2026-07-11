---
name: bp:proposal
description: [change-name] — Fill change proposal — intent, scope, approach, must-haves, non-goals
argument-hint: "[change-name]"
---

## Input

### Parameters
- **`$ARGUMENTS`** (required) — change name from `bp state` or user prompt.

### Prerequisites
- Change must be activated (status: `proposal`)
- `bp/requirements.md` must exist (for phase changes)

## Steps

### Step 1: Determine change type
Run `bp context plan` to read state. Check if this is a phase change or adhoc change.

**Phase change** — has milestone and phase in context, and requirements.md / context.md exist.
**Adhoc change** — no milestone/phase context.

### Step 2A: Phase change — fill from requirements
1. Read `bp/requirements.md` — extract FR/NFR IDs and descriptions
2. Read phase `context.md` — extract D IDs and decisions
3. Run `bp template proposal` to get the proposal skeleton
4. Write to `proposal.md`:
   - **Intent** — what problem/capability, who affected, why now
   - **References** — list FR/NFR and D IDs with source file paths:
     `FR-1: login  (bp/requirements.md)`, `D-1: JWT  (context.md)`
   - **External References** — list specs or docs this proposal references
     - **SHALL/MUST statement** — what observable behavior this deliverable produces
     - **How to verify** — how will you know it's done? (test, command output, manual step)
     - **Affected files** — which files/areas this touches
     - **refs: FR-{id}, D-{id}** — which requirements/decisions it implements
     - Example:
       ```
       - PR-1: login endpoint  refs: FR-1, D-1
         System SHALL accept email+password and return a JWT token.
         Verify: POST /login with valid credentials returns 200 + token.
         Files: src/auth/login.ts, src/auth/token.ts
       - PR-2: password hashing  refs: FR-1
         System SHALL hash passwords with bcrypt before storage.
         Verify: password column contains bcrypt hash, not plaintext.
         Files: src/auth/hash.ts
       ```
   - **PR splitting** — split by user-visible capability, not by implementation layer.
     "User can login" = PR-1, "User can reset password" = PR-2.
     Keep ≤ 5 PRs per change.
   - **Scope** — what's included, what's excluded

### Step 2B: Adhoc change — ask the user in detail
1. The change has no requirement references. **Ask the user** — use multiple questions to get enough detail:
   - "What problem are you fixing or what feature are you adding?"
   - "What exactly should happen? Describe the expected behavior step by step."
   - "How will you know it's working? What test or command confirms it?"
   - "What files or areas will this affect?"
   - "What's NOT included (out of scope)?"
2. Run `bp template proposal` to get the proposal skeleton
3. Write to `proposal.md` based on what the user described:
   - **Intent** — based on user description
   - **Deliverables** — `PR-1`, `PR-2`... Each with SHALL/MUST statement, verification, affected files
   - **Scope** — what's included
