import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  IMPLEMENTATION_STATES,
  validateConformanceReport
} from '../scripts/conformance-schema.mjs';

function validReport() {
  return {
    repository_commit: 'abc123',
    environment: { node: 'v22.16.0', npm: '10.9.2' },
    build_result: { status: 'PASS', exit_code: 0 },
    test_result: { status: 'PASS', discovered: 28, passed: 28, failed: 0, skipped: 0 },
    self_check_result: { status: 'PASS', host_integrated: false },
    source_backed_findings: [
      { id: 'F-001', summary: 'Example finding', evidence: ['src/kernel.ts'] }
    ],
    security_findings: [],
    conformance_coverage: [
      {
        id: 'INV-001',
        classification: 'IMPLEMENTED_AND_RUNTIME_TESTED',
        summary: 'Authority ordering has source and test evidence.',
        evidence: ['src/authority.ts', 'tests/authority.test.mjs']
      }
    ],
    test_coverage_gaps: [],
    runtime_overclaims: [],
    critical_blockers: [],
    smallest_safe_next_actions: ['Add adversarial authority tests.'],
    production_readiness_verdict: 'NOT_READY_FULL_V100'
  };
}

test('canonical implementation state set is exact', () => {
  assert.deepEqual([...IMPLEMENTATION_STATES], [
    'IMPLEMENTED_AND_RUNTIME_TESTED',
    'IMPLEMENTED_BUT_UNTESTED',
    'PARTIALLY_IMPLEMENTED',
    'DESIGN_ONLY',
    'NOT_IMPLEMENTED',
    'BLOCKED',
    'UNKNOWN'
  ]);
});

test('valid final conformance report is accepted', () => {
  assert.deepEqual(validateConformanceReport(validReport()), { valid: true, errors: [] });
});

test('missing required top-level field is rejected', () => {
  const report = validReport();
  delete report.test_result;
  const result = validateConformanceReport(report);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('test_result')));
});

test('unknown top-level field is rejected', () => {
  const result = validateConformanceReport({ ...validReport(), surprise: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('surprise')));
});

test('invalid implementation classification is rejected', () => {
  const report = validReport();
  report.conformance_coverage[0].classification = 'MAGIC_PASS';
  const result = validateConformanceReport(report);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('MAGIC_PASS')));
});

test('schema document declares strict top-level shape and canonical state enum', () => {
  const schema = JSON.parse(readFileSync('audit/schemas/conformance-report.schema.json', 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    schema.$defs.implementationState.enum,
    [...IMPLEMENTATION_STATES]
  );
  assert.ok(schema.required.includes('production_readiness_verdict'));
});
