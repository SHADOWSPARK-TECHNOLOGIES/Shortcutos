---
name: shortcutos-conformance
description: Run an evidence-first nine-phase ShortcutOS V100 conformance and security review without allowing generative claims to replace machine evidence.
---

# ShortcutOS V100 Conformance Skill

Use this skill to audit the repository. The deterministic evidence artifact is the primitive source for build, test, and self-check facts.

## Phase 1 — Environment capture

Run `node scripts/run-conformance.mjs` or use `--output <path>` for a stable artifact. Record repository commit/dirty state and Node/npm versions from the artifact.

## Phase 2 — Build verification

Read `build.exitCode`, stdout, and stderr from the primitive report. Do not infer build success from later test output.

## Phase 3 — Test execution and discovery validation

Read `tests.discovered`, `passed`, `failed`, `skipped`, and `status`. `INVALID_ZERO_TESTS` is never PASS.

## Phase 4 — ShortcutOS self-check

Read the captured self-check result. Preserve `hostIntegrated: false` when reported. Missing or malformed fields remain UNKNOWN.

## Phase 5 — Source ↔ contract ↔ test mapping

Map every record in `audit/fixtures/expected-invariants.json` to source and test evidence. The fixture defines questions, not answers.

## Phase 6 — Security/adversarial review

Inspect the threat checklist in `.agents/rules/shortcutos-v100-audit.md`. Report missing adversarial coverage separately from demonstrated vulnerabilities.

## Phase 7 — Canonical invariant review

Evaluate each invariant independently. Do not allow a passing aggregate suite to substitute for requirement-level evidence.

## Phase 8 — Full V100 coverage classification

Use only these classifications:

- `IMPLEMENTED_AND_RUNTIME_TESTED`
- `IMPLEMENTED_BUT_UNTESTED`
- `PARTIALLY_IMPLEMENTED`
- `DESIGN_ONLY`
- `NOT_IMPLEMENTED`
- `BLOCKED`
- `UNKNOWN`

A local subset test run does not establish complete V100 runtime conformance.

## Phase 9 — Strict JSON report generation

Produce the final report using `audit/schemas/conformance-report.schema.json` and no unknown top-level fields. Include:

- `repository_commit`
- `environment`
- `build_result`
- `test_result`
- `self_check_result`
- `source_backed_findings`
- `security_findings`
- `conformance_coverage`
- `test_coverage_gaps`
- `runtime_overclaims`
- `critical_blockers`
- `smallest_safe_next_actions`
- `production_readiness_verdict`

The final reviewer report is analysis of evidence, not a replacement for the raw evidence artifact or the human release gate.
