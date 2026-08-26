# ShortcutOS V100 Conformance Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portable, executable ShortcutOS V100 conformance kernel that enforces authority ordering, evidence-honest status transitions, context freshness/conflict handling, and verification-before-completion.

**Architecture:** Implement a dependency-free TypeScript core compiled with the installed TypeScript compiler and tested with Node's built-in test runner. The kernel exposes pure contracts for authority, verification status, evidence, and context plus a small run-state orchestrator; external tools/providers remain adapters and are never fabricated by core code.

**Tech Stack:** Node.js 22+, TypeScript 5.8+, Node built-in `node:test`, ESM.

**Spec:** `/mnt/data/ShortcutOS_V100_Always_On_Profile.md` plus `/mnt/data/ShortcutOS_V51-V100_Design_Execution_Report.md`

## Global Constraints

- ShortcutOS is subordinate to SYSTEM, DEVELOPER, TOOL/RUNTIME, and USER authority.
- Runtime verification requires actual runtime evidence.
- UNKNOWN, PARTIAL, and STALE states must remain explicit.
- Planning, execution, verification, and completion are distinct.
- Source presence does not imply claim verification.
- Context conflicts and stale state must be surfaced, not silently merged.
- No external dependencies are required for the core package.

---

### Task 1: Authority and Verification Kernel

**Files:**
- Create: `src/authority.ts`
- Create: `src/status.ts`
- Test: `tests/authority.test.mjs`
- Test: `tests/status.test.mjs`

**Interfaces:**
- Produces: `AuthorityLevel`, `canOverride()`, `VerificationStatus`, `promoteStatus()`.

- [ ] **Step 1: Write failing authority/status tests.**
- [ ] **Step 2: Run the build/test path and verify the tests fail because production modules do not exist.**
- [ ] **Step 3: Implement minimal authority/status contracts.**
- [ ] **Step 4: Run tests and verify they pass.**
- [ ] **Step 5: Commit/local checkpoint.**

### Task 2: Evidence Honesty Kernel

**Files:**
- Create: `src/evidence.ts`
- Test: `tests/evidence.test.mjs`

**Interfaces:**
- Produces: `EvidenceStatus`, `ClaimVerificationStatus`, `verifyClaim()`.

- [ ] **Step 1: Write failing claim verification tests.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal evidence rules.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Commit/local checkpoint.**

### Task 3: Context Freshness and Conflict Assembly

**Files:**
- Create: `src/context.ts`
- Test: `tests/context.test.mjs`

**Interfaces:**
- Produces: `ContextFreshness`, `ContextRecord`, `assembleContext()`.

- [ ] **Step 1: Write failing stale/conflict tests.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement deterministic working-set assembly.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Commit/local checkpoint.**

### Task 4: Run-State Orchestrator

**Files:**
- Create: `src/kernel.ts`
- Create: `src/index.ts`
- Test: `tests/kernel.test.mjs`

**Interfaces:**
- Consumes: authority/status/evidence/context contracts.
- Produces: `ShortcutOSKernel`, `createRun()`, `markPlanned()`, `markExecuted()`, `verify()`, `getRun()`.

- [ ] **Step 1: Write failing lifecycle tests.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal lifecycle state machine.**
- [ ] **Step 4: Verify GREEN and full regression suite.**
- [ ] **Step 5: Commit/local checkpoint.**

### Task 5: Conformance CLI and Package Documentation

**Files:**
- Create: `src/cli.ts`
- Create: `README.md`
- Create: `CONFORMANCE.md`
- Test: `tests/cli.test.mjs`

**Interfaces:**
- Produces: local `check-profile` / `demo` CLI commands and documented adapter boundary.

- [ ] **Step 1: Write failing CLI smoke test.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement CLI.**
- [ ] **Step 4: Run complete test suite and build.**
- [ ] **Step 5: Package portable archive.**

## Self-review

- Spec coverage: authority ordering, runtime honesty, context freshness/conflicts, evidence gating, and completion verification each map to Tasks 1–4.
- Runtime integrations intentionally remain outside this first conformance slice; adapters are the next implementation band.
- No placeholders are required by the runtime kernel itself; later adapters are explicitly a separate phase, not an unfinished step inside these tasks.

### Task 6: Canonical Registry

**Files:**
- Create: `src/registry.ts`
- Test: `tests/registry.test.mjs`

**Result:** Implemented with duplicate-ID rejection, direct aliases, alias-chain rejection, and deterministic listing.

### Task 7: Capability Resolver

**Files:**
- Create: `src/capability.ts`
- Test: `tests/capability.test.mjs`

**Result:** Implemented with explicit AVAILABLE/RESTRICTED/UNAVAILABLE/UNKNOWN states; missing/unknown capabilities are never fabricated as bound.

### Task 8: Adapter, Dispatch, and Single-Attempt Execution Boundary

**Files:**
- Create: `src/adapter.ts`
- Create: `src/dispatch.ts`
- Create: `src/executor.ts`
- Test: `tests/executor.test.mjs`

**Result:** Implemented with explicit adapter availability, capability-match gating, blocked dispatch state, exactly-one invocation, no automatic retry, and evidence-bearing result envelope.

### Task 9: Persistent Memory Journal

**Files:**
- Create: `src/memory.ts`
- Modify: `src/index.ts`
- Test: `tests/memory.test.mjs`

**Interfaces:**
- Produces: `MemoryJournal`, `MemoryJournalEvent`, `MemoryRecordState`, `MemoryRepository`, `MemoryTextStore`.
- Consumes: `ContextRecord`, `ContextFreshness`, `assembleContext()`.

- [x] **Step 1: Write failing tests for persistence, correction/supersession, tombstones, and active-context assembly.**
- [x] **Step 2: Run `npm test` and verify RED because `dist/memory.js` does not exist.**
- [x] **Step 3: Implement the minimal append-history memory repository over an injected text-store port.**
- [x] **Step 4: Run tests and verify GREEN.**
- [x] **Step 5: Commit/local checkpoint.**

### Task 10: Node Persistence and Local File Adapter

**Files:**
- Create: `node-adapters.mjs`
- Test: `tests/node-adapters.test.mjs`
- Modify: `cli.mjs`
- Modify: `README.md`
- Modify: `CONFORMANCE.md`
- Modify: `IMPLEMENTATION_STATUS.md`

**Interfaces:**
- Produces: `createNodeMemoryTextStore(filePath)`, `createLocalFileReadAdapter({ id, root })`.
- Consumes: `MemoryTextStore`, `ToolAdapter`, `AdapterAvailability`, `ExecutionResultStatus`.

- [x] **Step 1: Write failing tests proving memory survives a fresh repository instance and a root-scoped file adapter performs one real local file read.**
- [x] **Step 2: Verify RED because `node-adapters.mjs` does not exist.**
- [x] **Step 3: Implement atomic JSON persistence and root-confined local file reads.**
- [x] **Step 4: Extend `self-check` to exercise persistence and local adapter behavior in a temporary directory.**
- [x] **Step 5: Run `npm run check`, verify all tests/self-check pass, update docs, and package archive.**
