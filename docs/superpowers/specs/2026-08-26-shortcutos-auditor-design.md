# ShortcutOS V100 Workspace Auditor Design

**Date:** 2026-08-26  
**Status:** Approved in-chat architecture, pending written-spec review  
**Target repository:** `shortcutos-v100-runtime`  
**Primary execution surface:** Google Antigravity workspace-local custom agent + Node.js deterministic audit runner  
**Test framework:** Node.js built-in `node:test`  

## 1. Goal

Build a repository-local ShortcutOS V100 conformance auditor that separates deterministic machine evidence from generative review. The auditor must let Antigravity inspect and explain evidence without allowing the model itself to manufacture build, test, self-check, security, or conformance success states.

The implementation must not add production runtime features such as retries, provider fallback, scheduling, or specialist execution. This phase verifies and hardens the conformance surface first.

## 2. Core authority model

The authority chain for conformance is:

```text
ShortcutOS V100 canonical contracts
    ↓
Repository source code
    ↓
Deterministic audit runner
    ↓
Raw machine evidence
    ↓
Schema validation
    ↓
Antigravity reviewer
    ↓
Human release decision
```

Antigravity is a reviewer, not the source of truth. Its conclusions may summarize, classify, and identify gaps, but they may not replace raw command output or elevate an unverified state.

The existing ShortcutOS user-level authority hierarchy remains unchanged:

```text
SYSTEM
>
DEVELOPER
>
TOOL / RUNTIME CONTRACT
>
USER AUTHORITY
>
SHORTCUTOS V100
>
MISSION
>
TASK
>
COMMAND / CAPABILITY / TARGET / ROUTING / DISPATCH / EXECUTION
```

## 3. Repository layout

The feature adds the following repository-local structure:

```text
shortcutos-v100-runtime/
├── .agents/
│   ├── agents/
│   │   └── shortcutos-auditor/
│   │       └── agent.md
│   ├── skills/
│   │   └── shortcutos-conformance/
│   │       └── SKILL.md
│   └── rules/
│       └── shortcutos-v100-audit.md
├── audit/
│   ├── schemas/
│   │   └── conformance-report.schema.json
│   ├── fixtures/
│   │   └── expected-invariants.json
│   └── reports/
├── scripts/
│   └── run-conformance.mjs
├── tests/
│   ├── conformance-runner.test.mjs
│   └── conformance-schema.test.mjs
└── package.json
```

`audit/reports/` is generated output and must be ignored by Git except for an optional `.gitkeep` if needed for discoverability.

## 4. Deterministic conformance runner

`scripts/run-conformance.mjs` is the primitive fact collector. It must run from the repository root and execute the following commands without asking Antigravity to infer their results:

```text
git rev-parse HEAD
git status --porcelain
node --version
npm --version
npm run build
node --test tests/*.test.mjs
node cli.mjs self-check
```

The runner must deliberately invoke the raw test command rather than `npm test` for its test-count capture so that it can distinguish test discovery from build success. The repository's existing `npm test` script may remain unchanged.

The runner records, at minimum:

```ts
type CommandEvidence = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
};

type ConformancePrimitiveReport = {
  schemaVersion: '1.0';
  repository: {
    commit: string;
    dirty: boolean;
  };
  environment: {
    node: string;
    npm: string;
  };
  build: CommandEvidence;
  tests: CommandEvidence & {
    discovered: number;
    passed: number;
    failed: number;
    skipped: number;
    status: 'PASS' | 'FAIL' | 'INVALID_ZERO_TESTS' | 'UNKNOWN';
  };
  selfCheck: CommandEvidence & {
    status: 'PASS' | 'FAIL' | 'UNKNOWN';
    hostIntegrated: boolean | null;
  };
};
```

### Zero-test rule

The runner must enforce:

```text
exitCode == 0 AND discovered == 0
=> tests.status = INVALID_ZERO_TESTS
```

An empty test run must never be reported as PASS.

### Failure behavior

A failed build, test command, or self-check must still produce a report. The runner must not crash before writing evidence unless it cannot establish the repository root or cannot create the requested report output.

A command spawn failure must be represented as structured evidence with `exitCode` set to a non-success sentinel and the spawn error preserved in `stderr`.

## 5. Report schema

`audit/schemas/conformance-report.schema.json` defines the machine-readable final report contract. The schema must support these canonical implementation classifications:

```text
IMPLEMENTED_AND_RUNTIME_TESTED
IMPLEMENTED_BUT_UNTESTED
PARTIALLY_IMPLEMENTED
DESIGN_ONLY
NOT_IMPLEMENTED
BLOCKED
UNKNOWN
```

The final report must contain:

```text
repository_commit
environment
build_result
test_result
self_check_result
source_backed_findings
security_findings
conformance_coverage
test_coverage_gaps
runtime_overclaims
critical_blockers
smallest_safe_next_actions
production_readiness_verdict
```

The schema must reject unknown top-level fields to reduce accidental contract drift.

The implementation must use a small local validator rather than adding a heavy third-party schema dependency unless the existing repository already contains one. Because the current runtime is dependency-free, the first implementation should keep that property.

## 6. Expected invariant fixture

`audit/fixtures/expected-invariants.json` is a canonical list of conformance questions that the reviewer must map to source and tests. Initial invariants include:

1. System/developer/tool/user authority cannot be overridden by ShortcutOS.
2. Planning is distinct from routing.
3. Routing is distinct from dispatch.
4. Dispatch is distinct from execution.
5. Execution is distinct from verification.
6. Task success is distinct from mission completion.
7. `UNKNOWN` is never silently promoted to success.
8. `PARTIAL` remains explicit.
9. `STALE` remains explicit.
10. Missing capabilities are not invented.
11. Unavailable adapters are not invoked.
12. Execution performs at most one adapter invocation in the current runtime slice.
13. Invocation failure does not silently retry.
14. Evidence is required before runtime verification state promotion.
15. Conflicting context is surfaced rather than silently merged.
16. Persistent memory preserves append history, supersession, and tombstones.
17. Local file reads remain confined to the configured root.
18. Host integration remains explicitly false for the portable package.

This fixture is evidence-target metadata only. Its existence does not prove any invariant passes.

## 7. Antigravity custom agent

`.agents/agents/shortcutos-auditor/agent.md` defines a repository-local reviewer.

Its behavioral constraints are:

```text
You are a reviewer, not the conformance authority.

You MAY:
- inspect repository source and tests;
- execute the approved conformance runner;
- inspect raw evidence artifacts;
- map requirements to source and tests;
- identify missing or weak tests;
- classify implementation states;
- produce a JSON conformance report that conforms to the repository schema.

You MUST NOT:
- modify production source during an audit;
- invent command output;
- claim a test ran without recorded evidence;
- treat exit code zero with zero tests as PASS;
- change UNKNOWN/PARTIAL/STALE to a stronger state without evidence;
- silently retry commands;
- silently switch tools, models, providers, or execution targets;
- label full ShortcutOS V100 runtime conformance as proven merely because the implemented local slice passes.
```

The agent tool declaration must be minimal and read/audit oriented. If Antigravity's exact frontmatter field names differ by installed version, the checked-in agent must use the currently documented syntax at implementation time and the repository tests must validate only repository-owned semantics, not vendor internals.

## 8. Reusable conformance skill

`.agents/skills/shortcutos-conformance/SKILL.md` defines the nine-phase audit workflow:

1. Environment capture.
2. Build verification.
3. Test execution and discovery validation.
4. ShortcutOS self-check.
5. Source ↔ contract ↔ test mapping.
6. Security/adversarial review.
7. Canonical invariant review.
8. Full V100 coverage classification.
9. Strict JSON report generation.

The skill must instruct the reviewer to use the deterministic evidence artifact as the primitive source for build/test/self-check facts.

## 9. Audit rule file

`.agents/rules/shortcutos-v100-audit.md` contains non-negotiable repository audit rules:

- No fabricated machine state.
- No numeric confidence or readiness score unless derived from an explicitly defined metric.
- No production writes during conformance review.
- No hidden retries.
- No silent provider or model rebinding.
- No unbounded concurrency.
- No full-V100 conformance claim from local subset tests.
- Every material finding must point to source, test, raw evidence, or be explicitly labeled as an unverified hypothesis.

## 10. Security coverage

The initial auditor must inspect or flag missing tests for:

```text
authority escalation
dispatch bypass
execution without dispatch
capability spoofing
adapter registry poisoning
alias/registry poisoning
evidence spoofing
UNKNOWN → SUCCESS coercion
PARTIAL → SUCCESS coercion
silent retry
silent provider rebinding
duplicate execution
idempotency violations
timeout ambiguity
AbortSignal behavior
unknown side effects
memory journal corruption
concurrent writer loss
stale-state reuse
conflict suppression
path traversal
symlink escape
TOCTOU
oversized file reads
special-file reads
sensitive-path leakage
```

The auditor is allowed to report `NOT_IMPLEMENTED`, `PARTIALLY_IMPLEMENTED`, or `UNKNOWN`. It must never invent a PASS for a security property that lacks a deterministic test or source-backed proof.

## 11. Data flow

```text
Developer / Reviewer
      ↓
run-conformance.mjs
      ↓
raw subprocess results
      ↓
primitive report JSON
      ↓
conformance schema / invariant fixture
      ↓
Antigravity shortcutos-auditor
      ↓
source/test/evidence mapping
      ↓
strict final JSON report
      ↓
human release decision
```

The raw primitive report must remain separately inspectable from the final generative review report.

## 12. Testing strategy

The feature uses Node.js built-in `node:test`.

### Runner tests

`tests/conformance-runner.test.mjs` must prove:

- repository metadata is captured;
- command exit codes are preserved;
- build failure remains visible;
- a real non-zero test count can be parsed;
- zero discovered tests with exit code zero becomes `INVALID_ZERO_TESTS`;
- self-check JSON is parsed without inventing missing fields;
- failure still yields a report;
- no retry occurs for a failed command.

The production runner should expose pure parsing/classification helpers through a small importable module if needed, while the executable script remains a thin CLI wrapper.

### Schema tests

`tests/conformance-schema.test.mjs` must prove:

- valid report structures are accepted by the local validator;
- missing required top-level fields are rejected;
- unknown top-level fields are rejected;
- invalid implementation-state strings are rejected.

### Regression gate

The complete repository suite must remain green after the auditor feature is added:

```text
npm run build
npm test
node cli.mjs self-check
```

The auditor's tests are additive and must not weaken or replace existing tests.

## 13. Git and generated artifacts

`audit/reports/*.json` must be ignored by Git because those files contain run-specific evidence. The schema, fixture, custom agent, skill, rules, and runner remain version-controlled.

The runner should default to writing a timestamped JSON file under `audit/reports/` and allow `--output <path>` for deterministic tests and CI use.

## 14. Scope exclusions

This phase does not implement:

- retry/fallback execution controllers;
- provider connectors;
- timeout cancellation inside the core executor;
- scheduler runtime;
- specialist runtime;
- recovery runtime;
- persistent database-backed audit storage;
- hosted CI integration;
- MCP service packaging;
- distributable Antigravity plugin packaging.

Those capabilities remain future work after the auditor proves the current runtime boundary.

## 15. Acceptance criteria

The feature is accepted only when all of the following are true:

1. The repository-local custom agent, skill, and rules exist in the approved workspace layout.
2. `scripts/run-conformance.mjs` captures the required primitive facts and writes a JSON report even when a verification command fails.
3. Exit code zero with zero discovered tests is classified as `INVALID_ZERO_TESTS`.
4. The strict final-report schema and local validator reject malformed reports.
5. The invariant fixture exists and does not itself claim test results.
6. The auditor instructions prohibit production mutation and unsupported runtime claims.
7. The runner and schema behavior are covered by `node:test` tests written test-first.
8. Existing repository tests remain green.
9. `node cli.mjs self-check` remains green.
10. The final implementation documentation states the exact boundary: local conformance tooling implemented; full V100 runtime conformance still not proven.

## 16. Post-acceptance sequence

After this auditor is implemented and verified, the next runtime hardening sequence is:

```text
trusted evidence envelope
→ real acceptance evaluator
→ full dispatch preflight
→ timeout / abort / unknown-side-effect semantics
→ memory runtime schema validation
→ memory concurrency/version control
→ adapter registration provenance
→ adversarial security tests
→ bounded retry/fallback
```

No retry/fallback implementation should begin before the relevant timeout, side-effect, dispatch, memory-concurrency, and evidence-preflight boundaries are verified.
