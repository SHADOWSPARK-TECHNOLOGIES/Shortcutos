# ShortcutOS V100 Workspace Auditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repository-local deterministic ShortcutOS V100 conformance auditor that captures machine evidence independently of Antigravity and exposes a read-oriented Antigravity reviewer configuration.

**Architecture:** A dependency-free Node.js evidence library performs command capture and classification, while `scripts/run-conformance.mjs` is a thin CLI wrapper that writes primitive JSON evidence. A separate local report validator enforces the strict final-review contract. Workspace-local Antigravity agent, skill, and rule files consume the evidence but never manufacture machine state.

**Tech Stack:** Node.js 22+, ECMAScript modules, built-in `node:test`, TypeScript compiler for the existing runtime, JSON/Markdown repository assets, Google Antigravity Markdown agents.

**Spec:** `docs/superpowers/specs/2026-08-26-shortcutos-auditor-design.md`

## Global Constraints

- Keep the runtime dependency-free; add no Jest, Vitest, Ajv, or other npm runtime/test dependency.
- Use Node.js built-in `node:test` for all new automated tests.
- Preserve existing `npm test` behavior and all existing 28 tests.
- The deterministic runner is the authority for primitive build/test/self-check facts; Antigravity is only a reviewer.
- `exitCode === 0 && discovered === 0` MUST classify as `INVALID_ZERO_TESTS`.
- Failed verification commands MUST still produce evidence.
- No hidden retry, provider/model rebinding, production-source mutation, or full-V100 conformance claim.
- Generated `audit/reports/*.json` evidence MUST remain ignored by Git.
- Agent configuration MUST use current documented Antigravity Markdown-agent fields and a read/audit-oriented tool list.
- Full V100 runtime conformance remains unproven after this feature; the implementation only adds conformance tooling.

---

### Task 1: Pure conformance parsing and command-evidence helpers

**Files:**
- Create: `scripts/conformance-lib.mjs`
- Create: `tests/conformance-runner.test.mjs`

**Interfaces:**
- Produces: `parseNodeTestSummary(output)`, `classifyTestResult(exitCode, summary)`, `parseSelfCheck(stdout, exitCode)`, `captureCommandEvidence(command, args, options?)`.
- `parseNodeTestSummary(output)` returns `{ discovered, passed, failed, skipped }` using Node TAP summary lines and uses zero for absent numeric fields.
- `classifyTestResult(exitCode, summary)` returns `PASS | FAIL | INVALID_ZERO_TESTS | UNKNOWN`.
- `parseSelfCheck(stdout, exitCode)` returns `{ status: 'PASS'|'FAIL'|'UNKNOWN', hostIntegrated: boolean|null }` without inventing absent fields.
- `captureCommandEvidence` executes exactly once and returns `{ command, exitCode, stdout, stderr, startedAt, finishedAt }`; a spawn error is captured with `exitCode: -1`.

- [ ] **Step 1: Write failing parser/classification tests**

Add tests that import the four interfaces and assert:

```js
assert.deepEqual(parseNodeTestSummary('# tests 28\n# pass 28\n# fail 0\n# skipped 0\n'), {
  discovered: 28,
  passed: 28,
  failed: 0,
  skipped: 0
});
assert.equal(classifyTestResult(0, { discovered: 0, passed: 0, failed: 0, skipped: 0 }), 'INVALID_ZERO_TESTS');
assert.equal(classifyTestResult(0, { discovered: 2, passed: 2, failed: 0, skipped: 0 }), 'PASS');
assert.equal(classifyTestResult(1, { discovered: 2, passed: 1, failed: 1, skipped: 0 }), 'FAIL');
```

Also assert self-check parsing preserves `hostIntegrated: false` and returns `UNKNOWN/null` for invalid JSON instead of fabricating values.

- [ ] **Step 2: Run the new test file and verify RED**

Run:

```bash
node --test tests/conformance-runner.test.mjs
```

Expected: FAIL because `scripts/conformance-lib.mjs` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

Implement summary parsing with anchored multiline regular expressions for `# tests`, `# pass`, `# fail`, and `# skipped`. Implement classification order as: non-zero exit → `FAIL`; zero discovered → `INVALID_ZERO_TESTS`; discovered > 0 and failed === 0 → `PASS`; otherwise `UNKNOWN`.

Implement self-check parsing by JSON.parse; only `status === 'PASS'` with exit code zero becomes PASS, non-zero exit becomes FAIL, malformed/missing status becomes UNKNOWN. `hostIntegrated` is returned only when boolean, otherwise null.

Implement command capture with `spawnSync(process.execPath...)`-compatible generic command invocation, no retry loop, ISO timestamps, and spawn-error capture.

- [ ] **Step 4: Run the new tests and verify GREEN**

```bash
node --test tests/conformance-runner.test.mjs
```

Expected: all Task 1 tests PASS.

- [ ] **Step 5: Add a no-retry regression test**

Inject a small temporary executable/counter command or injectable spawn function so a failing command can prove exactly one invocation. Assert the counter is `1` after failure.

- [ ] **Step 6: Run Task 1 tests again**

```bash
node --test tests/conformance-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add scripts/conformance-lib.mjs tests/conformance-runner.test.mjs
git commit -m "test: add deterministic conformance primitives"
```

---

### Task 2: Deterministic primitive report builder and CLI

**Files:**
- Modify: `scripts/conformance-lib.mjs`
- Create: `scripts/run-conformance.mjs`
- Modify: `tests/conformance-runner.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes Task 1 helpers.
- Produces: `runPrimitiveConformance({ root, runCommand? })` returning the primitive report from the approved spec.
- Produces CLI behavior: `node scripts/run-conformance.mjs [--output path]`.

- [ ] **Step 1: Write failing primitive-report tests**

Use an injected `runCommand` fake keyed by exact command string. Assert `runPrimitiveConformance()`:

```js
assert.equal(report.schemaVersion, '1.0');
assert.equal(report.repository.commit, 'abc123');
assert.equal(report.repository.dirty, true);
assert.equal(report.environment.node, 'v22.16.0');
assert.equal(report.tests.discovered, 3);
assert.equal(report.tests.status, 'PASS');
assert.equal(report.selfCheck.status, 'PASS');
assert.equal(report.selfCheck.hostIntegrated, false);
```

Add a failure-path fixture where build exits 2, tests exit 1, self-check exits 1, and verify the report is still returned with each non-zero exit preserved.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test tests/conformance-runner.test.mjs
```

Expected: FAIL because `runPrimitiveConformance` is missing.

- [ ] **Step 3: Implement `runPrimitiveConformance`**

Execute, exactly once each, in this order:

```text
git rev-parse HEAD
git status --porcelain
node --version
npm --version
npm run build
node --test tests/*.test.mjs
node cli.mjs self-check
```

Use shell execution only where glob expansion is needed for `tests/*.test.mjs`; preserve the exact display command in evidence. Do not short-circuit after build/test/self-check failure. Repository-root resolution failure remains fatal.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
node --test tests/conformance-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write failing CLI output test**

Spawn `node scripts/run-conformance.mjs --output <temp-file>` against the real repository and assert the output file is valid JSON with `schemaVersion: '1.0'`, non-empty commit, `tests.discovered > 0`, and `tests.status === 'PASS'` on the green baseline.

- [ ] **Step 6: Implement CLI output behavior**

Default output path:

```text
audit/reports/conformance-<ISO timestamp sanitized for filenames>.json
```

`--output <path>` overrides it. Create the parent directory recursively. Write pretty JSON and print only a concise final line containing the report path and primitive status summary.

- [ ] **Step 7: Ignore generated reports**

Add:

```gitignore
audit/reports/*.json
!audit/reports/.gitkeep
```

Create `audit/reports/.gitkeep`.

- [ ] **Step 8: Run Task 2 tests**

```bash
node --test tests/conformance-runner.test.mjs
```

Expected: PASS including the real CLI report test.

- [ ] **Step 9: Commit Task 2**

```bash
git add scripts/run-conformance.mjs scripts/conformance-lib.mjs tests/conformance-runner.test.mjs .gitignore audit/reports/.gitkeep
git commit -m "feat: add deterministic conformance runner"
```

---

### Task 3: Strict final-report schema and local validator

**Files:**
- Create: `audit/schemas/conformance-report.schema.json`
- Create: `scripts/conformance-schema.mjs`
- Create: `tests/conformance-schema.test.mjs`

**Interfaces:**
- Produces: `IMPLEMENTATION_STATES` constant.
- Produces: `validateConformanceReport(value)` returning `{ valid: boolean, errors: string[] }`.
- The validator enforces required top-level keys, rejects unknown top-level keys, and validates every `conformance_coverage[].classification` against the canonical state set.

- [ ] **Step 1: Write failing schema-validator tests**

Create a valid report fixture in test code with exactly these required keys:

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

Assert the valid report passes. Assert a missing required key fails, an unexpected top-level key fails, and classification `MAGIC_PASS` fails.

- [ ] **Step 2: Run schema tests and verify RED**

```bash
node --test tests/conformance-schema.test.mjs
```

Expected: FAIL because validator/schema files do not exist.

- [ ] **Step 3: Implement the canonical JSON Schema document**

Use Draft 2020-12 vocabulary, `additionalProperties: false` at the top level, and enum the seven implementation classifications. Keep nested finding objects permissive enough for reviewer evidence details while requiring core fields such as `id`, `classification` where relevant, `summary`, and `evidence` arrays.

- [ ] **Step 4: Implement the dependency-free validator**

Read no files at import time. Validate JavaScript objects directly. Enforce object type, exact top-level key set, required array/string/object shapes, and allowed classification values. Return all detected errors rather than throwing on the first malformed field.

- [ ] **Step 5: Run schema tests and verify GREEN**

```bash
node --test tests/conformance-schema.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add audit/schemas/conformance-report.schema.json scripts/conformance-schema.mjs tests/conformance-schema.test.mjs
git commit -m "feat: define strict conformance report contract"
```

---

### Task 4: Canonical invariant fixture and Antigravity workspace auditor

**Files:**
- Create: `audit/fixtures/expected-invariants.json`
- Create: `.agents/agents/shortcutos-auditor/agent.md`
- Create: `.agents/skills/shortcutos-conformance/SKILL.md`
- Create: `.agents/rules/shortcutos-v100-audit.md`
- Create: `tests/auditor-config.test.mjs`

**Interfaces:**
- The fixture exposes exactly 18 invariant records, each with stable `id`, `statement`, and `evidenceRequired` fields.
- The Antigravity agent uses documented YAML frontmatter: `name`, `description`, `tools`, `mainAgent`, `subagent`, `model`, `commandExecutionPolicy`, `skills`.
- Allowed agent tools are read/audit only: `view_file`, `grep_search`, `run_command`.
- `commandExecutionPolicy` is `sandbox`.

- [ ] **Step 1: Write failing configuration tests**

Read the repository files as text/JSON and assert:

```js
assert.equal(invariants.length, 18);
assert.match(agentText, /name: shortcutos-auditor/);
assert.match(agentText, /commandExecutionPolicy: sandbox/);
assert.match(agentText, /- view_file/);
assert.match(agentText, /- grep_search/);
assert.match(agentText, /- run_command/);
assert.doesNotMatch(agentText, /replace_file_content/);
assert.match(skillText, /Environment capture/);
assert.match(skillText, /Strict JSON report generation/);
assert.match(ruleText, /No fabricated machine state/);
```

Also assert the agent explicitly prohibits production-source modification and full-V100 conformance overclaiming.

- [ ] **Step 2: Run config tests and verify RED**

```bash
node --test tests/auditor-config.test.mjs
```

Expected: FAIL because files are absent.

- [ ] **Step 3: Create the 18-invariant fixture**

Translate the approved design invariant list one-to-one into stable IDs `INV-001` through `INV-018`. Set `evidenceRequired` to arrays such as `['source','test']` or `['raw_evidence','source']`; do not include pass/fail state in the fixture.

- [ ] **Step 4: Create the Antigravity agent**

Use frontmatter:

```yaml
---
name: shortcutos-auditor
description: Independent ShortcutOS V100 conformance and security reviewer that relies on deterministic repository evidence.
tools:
  - view_file
  - grep_search
  - run_command
mainAgent: true
subagent: true
model: pro
commandExecutionPolicy: sandbox
skills:
  - skills/shortcutos-conformance
---
```

The body must state that the agent is not the conformance authority, must run/read the deterministic evidence artifact, must not modify production source during audit, must not retry silently, and must output only evidence-supported classifications.

- [ ] **Step 5: Create the nine-phase skill and audit rules**

The skill phases are exactly the approved nine phases. Include the seven classification values and direct the reviewer to `audit/schemas/conformance-report.schema.json`.

The rule file includes the approved non-negotiable rules and security checklist, explicitly labeling unproven properties as `UNKNOWN`, `PARTIALLY_IMPLEMENTED`, or `NOT_IMPLEMENTED` rather than PASS.

- [ ] **Step 6: Run config tests and verify GREEN**

```bash
node --test tests/auditor-config.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add audit/fixtures/expected-invariants.json .agents tests/auditor-config.test.mjs
git commit -m "feat: add Antigravity ShortcutOS auditor"
```

---

### Task 5: Package scripts, documentation, and end-to-end conformance evidence

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CONFORMANCE.md`
- Modify: `IMPLEMENTATION_STATUS.md`
- Test: full existing and new suites

**Interfaces:**
- Adds package script `audit:conformance`: `node scripts/run-conformance.mjs`.
- Documentation states local conformance tooling is implemented while full V100 runtime conformance remains unproven.

- [ ] **Step 1: Write/extend a package-script regression assertion**

Add a test in `tests/auditor-config.test.mjs` that loads `package.json` and asserts:

```js
assert.equal(pkg.scripts['audit:conformance'], 'node scripts/run-conformance.mjs');
```

Run it before modifying package.json and confirm RED.

- [ ] **Step 2: Add the package script and documentation**

Document:

```bash
npm run audit:conformance
npm run audit:conformance -- --output audit/reports/manual.json
```

Document Antigravity use:

```text
agy
/agents
select shortcutos-auditor
```

State that primitive evidence is deterministic but final AI findings remain reviewer output subject to human release approval.

- [ ] **Step 3: Run the complete repository test suite**

```bash
npm test
```

Expected: all original and new tests PASS, with non-zero discovered test count.

- [ ] **Step 4: Run the self-check**

```bash
node cli.mjs self-check
```

Expected: PASS with `hostIntegrated: false`.

- [ ] **Step 5: Run the real deterministic auditor**

```bash
node scripts/run-conformance.mjs --output /tmp/shortcutos-v100-conformance.json
```

Inspect the generated JSON and verify:

```text
schemaVersion == 1.0
repository.commit is non-empty
tests.discovered > 0
tests.status == PASS
selfCheck.status == PASS
selfCheck.hostIntegrated == false
```

- [ ] **Step 6: Verify Git cleanliness except intended changes**

```bash
git status --short
```

Generated evidence under ignored `audit/reports/*.json` must not appear.

- [ ] **Step 7: Commit Task 5**

```bash
git add package.json README.md CONFORMANCE.md IMPLEMENTATION_STATUS.md tests/auditor-config.test.mjs
git commit -m "docs: integrate ShortcutOS conformance auditor"
```

---

### Task 6: Final regression, requirement review, and implementation handoff

**Files:**
- Review all feature files against the approved spec.

**Interfaces:**
- Produces no new runtime capability; this is the verification gate.

- [ ] **Step 1: Run fresh build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 2: Run fresh full suite**

```bash
npm test
```

Expected: all tests pass; zero-test output is forbidden.

- [ ] **Step 3: Run fresh self-check**

```bash
node cli.mjs self-check
```

Expected: PASS and `hostIntegrated: false`.

- [ ] **Step 4: Run fresh conformance evidence capture**

```bash
node scripts/run-conformance.mjs --output /tmp/shortcutos-v100-final-conformance.json
```

Expected primitive report test status PASS with non-zero discovery.

- [ ] **Step 5: Self-review spec coverage**

Check all 10 acceptance criteria in the approved design against concrete files/tests/evidence. Any unmet item blocks completion.

- [ ] **Step 6: Inspect branch diff and cleanliness**

```bash
git status --short
git log --oneline --decorate -8
git diff master...HEAD --stat
```

Expected: working tree clean and only auditor-related changes.

- [ ] **Step 7: Stop at branch integration decision**

Do not merge automatically. Present the standard local-merge / push-PR / keep-branch options after fresh verification.
