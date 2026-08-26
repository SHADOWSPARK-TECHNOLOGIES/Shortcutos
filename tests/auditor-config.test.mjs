import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

test('expected invariant fixture contains exactly 18 evidence targets without pass states', () => {
  const invariants = JSON.parse(read('audit/fixtures/expected-invariants.json'));
  assert.equal(invariants.length, 18);
  assert.deepEqual(invariants.map(item => item.id),
    Array.from({ length: 18 }, (_, index) => `INV-${String(index + 1).padStart(3, '0')}`));
  for (const invariant of invariants) {
    assert.equal(typeof invariant.statement, 'string');
    assert.ok(invariant.statement.length > 0);
    assert.ok(Array.isArray(invariant.evidenceRequired));
    assert.ok(invariant.evidenceRequired.length > 0);
    assert.equal('status' in invariant, false);
    assert.equal('pass' in invariant, false);
  }
});

test('Antigravity auditor uses read-oriented tools and sandbox command policy', () => {
  const agent = read('.agents/agents/shortcutos-auditor/agent.md');
  assert.match(agent, /name: shortcutos-auditor/);
  assert.match(agent, /commandExecutionPolicy: sandbox/);
  assert.match(agent, /model: pro/);
  assert.match(agent, /mainAgent: true/);
  assert.match(agent, /subagent: true/);
  assert.match(agent, /- view_file/);
  assert.match(agent, /- grep_search/);
  assert.match(agent, /- run_command/);
  assert.doesNotMatch(agent, /replace_file_content/);
  assert.match(agent, /reviewer, not the conformance authority/i);
  assert.match(agent, /MUST NOT modify production source/i);
  assert.match(agent, /full ShortcutOS V100 runtime conformance/i);
});

test('conformance skill contains all nine phases and strict classifications', () => {
  const skill = read('.agents/skills/shortcutos-conformance/SKILL.md');
  for (const phrase of [
    'Environment capture',
    'Build verification',
    'Test execution and discovery validation',
    'ShortcutOS self-check',
    'Source ↔ contract ↔ test mapping',
    'Security/adversarial review',
    'Canonical invariant review',
    'Full V100 coverage classification',
    'Strict JSON report generation'
  ]) {
    assert.match(skill, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const state of [
    'IMPLEMENTED_AND_RUNTIME_TESTED',
    'IMPLEMENTED_BUT_UNTESTED',
    'PARTIALLY_IMPLEMENTED',
    'DESIGN_ONLY',
    'NOT_IMPLEMENTED',
    'BLOCKED',
    'UNKNOWN'
  ]) {
    assert.match(skill, new RegExp(state));
  }
  assert.match(skill, /audit\/schemas\/conformance-report\.schema\.json/);
});

test('audit rules prohibit fabricated state, hidden retries and unsupported conformance claims', () => {
  const rules = read('.agents/rules/shortcutos-v100-audit.md');
  assert.match(rules, /No fabricated machine state/);
  assert.match(rules, /No hidden retries/);
  assert.match(rules, /No silent provider or model rebinding/);
  assert.match(rules, /No production writes during conformance review/);
  assert.match(rules, /No full-V100 conformance claim from local subset tests/);
  for (const threat of ['TOCTOU', 'capability spoofing', 'evidence spoofing', 'concurrent writer loss']) {
    assert.match(rules, new RegExp(threat, 'i'));
  }
});


test('package exposes deterministic conformance audit script', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['audit:conformance'], 'node scripts/run-conformance.mjs');
});
