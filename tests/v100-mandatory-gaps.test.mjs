import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractClaimsFromEvidence
} from '../dist/evidence-system.js';

import {
  ContextCarrier,
  MemoryTier,
  restoreFromCheckpoint,
  compressContext,
  reconcileStateDrift
} from '../dist/memory-system.js';

import {
  SpecialistRole,
  createSpecialist,
  executeSpecialistHandoff
} from '../dist/specialist.js';

import {
  executeRecoveryPlan,
  compileRecoveryPlan,
  selectMinimalRepairPlan,
  RecoveryJournal
} from '../dist/recovery-runtime.js';

import { validateExportSurface } from '../dist/index.js';

test('V43-001 RED: extractClaimsFromEvidence extracts structured ClaimRecord objects from evidence envelopes', () => {
  const envelope = {
    id: 'evi-101',
    kind: 'security-scan',
    ref: 'src/kernel.ts',
    source: 'audit-tool',
    timestamp: new Date().toISOString(),
    integrity: 'checksum-valid',
    payload: {
      passed: true,
      findings: ['no injection vulnerability', 'strict preflight enforced']
    }
  };

  const claims = extractClaimsFromEvidence(envelope);
  assert.ok(Array.isArray(claims));
  assert.ok(claims.length >= 2);
  assert.equal(claims[0].sourceId, 'audit-tool');
  assert.equal(claims[0].confidence, 1.0);
  assert.ok(claims[0].statement.includes('no injection vulnerability'));
});

test('V58-001 RED: restoreFromCheckpoint restores context entries from checkpoint snapshot', () => {
  const carrier = new ContextCarrier({ tokenBudget: 1000 });
  carrier.addEntry('old-1', 'v1', MemoryTier.SHORT_TERM);

  const checkpoint = {
    id: 'chk-1',
    timestamp: '2026-08-27T10:00:00Z',
    entries: [
      { key: 'snap-1', value: 'val-snap', estimatedTokens: 15, timestamp: '2026-08-27T09:00:00Z', tier: MemoryTier.SHORT_TERM }
    ],
    stateHash: '123456789'
  };

  const result = restoreFromCheckpoint(carrier, checkpoint);
  assert.equal(result.restoredCount, 1);
  assert.equal(result.carrier.getEntry('snap-1')?.key, 'snap-1');
});

test('V59-001 RED: compressContext condenses context entries to fit target token budget', () => {
  const entries = [
    { key: 'e1', value: 'short text', estimatedTokens: 50, timestamp: '2026-08-27T10:00:00Z', tier: 'ACTIVE' },
    { key: 'e2', value: 'a very long historical context text that takes many tokens', estimatedTokens: 150, timestamp: '2026-08-27T09:00:00Z', tier: 'WORKING' }
  ];

  const compressed = compressContext(entries, 80);
  assert.ok(compressed.totalTokens <= 80);
  assert.ok(compressed.compressedCount > 0);
});

test('V68-001 RED: reconcileStateDrift detects state hash mismatch between checkpoint and current entries', () => {
  const checkpoint = {
    id: 'chk-1',
    timestamp: '2026-08-27T10:00:00Z',
    entries: [
      { key: 'k1', value: 'v1', estimatedTokens: 10, timestamp: '2026-08-27T09:00:00Z', tier: 'ACTIVE' }
    ],
    stateHash: 'hash-abc-123'
  };

  const currentEntries = [
    { key: 'k1', value: 'MODIFIED_VALUE', estimatedTokens: 10, timestamp: '2026-08-27T11:00:00Z', tier: 'ACTIVE' }
  ];

  const drift = reconcileStateDrift(checkpoint, currentEntries);
  assert.equal(drift.drifted, true);
  assert.ok(drift.mismatchedKeys.includes('k1'));
});

test('V72-V79 RED: createSpecialist instantiates 8 domain specialists with distinct domain policies and capabilities', () => {
  const roles = [
    SpecialistRole.RESEARCH,
    SpecialistRole.SOFTWARE_ENGINEERING,
    SpecialistRole.ARCHITECTURE,
    SpecialistRole.SECURITY,
    SpecialistRole.BUSINESS,
    SpecialistRole.CONTENT,
    SpecialistRole.MARKETING,
    SpecialistRole.AUTOMATION
  ];

  for (const role of roles) {
    const spec = createSpecialist(role);
    assert.equal(spec.role, role);
    assert.ok(Array.isArray(spec.requiredCapabilities));
    assert.ok(spec.requiredCapabilities.length > 0);
  }

  const secSpec = createSpecialist(SpecialistRole.SECURITY);
  assert.ok(secSpec.requiredCapabilities.includes('security.audit'));

  const sweSpec = createSpecialist(SpecialistRole.SOFTWARE_ENGINEERING);
  assert.ok(sweSpec.requiredCapabilities.includes('file.write'));
});

test('V83-001 RED: executeSpecialistHandoff evaluates domain capabilities and rejects invalid handoffs', () => {
  const researchSpec = createSpecialist(SpecialistRole.RESEARCH);
  const secSpec = createSpecialist(SpecialistRole.SECURITY);

  // researchSpec lacks security.audit capability
  assert.throws(
    () => executeSpecialistHandoff(secSpec, researchSpec, { task: 'security-audit' }),
    (err) => err instanceof Error && err.message.includes('SPECIALIST_POLICY_VIOLATION')
  );
});

test('V89-001 GREEN: executeRecoveryPlan tracks partial state restoration records', async () => {
  const plan = compileRecoveryPlan({
    failureCode: 'RESOURCE_EXHAUSTED',
    compensatingActions: [
      { id: 'act-1', description: 'rollback draft', compensationKind: 'RESTORE_STATE' }
    ]
  });

  const result = await executeRecoveryPlan(plan);
  assert.ok(Array.isArray(result.restoredStates));
  assert.equal(result.restoredStates.length, 1);
  assert.equal(result.restoredStates[0].actionId, 'act-1');
});

test('V92-001 RED: selectMinimalRepairPlan prunes redundant actions to produce minimal repair set', () => {
  const actions = [
    { id: 'act-1', description: 'restart worker', compensationKind: 'RETRY' },
    { id: 'act-2', description: 'redundant restart worker', compensationKind: 'RETRY' },
    { id: 'act-3', description: 'clean cache', compensationKind: 'CLEANUP' }
  ];

  const minimal = selectMinimalRepairPlan(actions);
  assert.equal(minimal.length, 2);
  assert.equal(minimal[0].id, 'act-1');
  assert.equal(minimal[1].id, 'act-3');
});

test('V93-001 RED: RecoveryJournal records resumable recovery step history', () => {
  const journal = new RecoveryJournal('rec-session-100');
  journal.recordStep('act-1', 'SUCCEEDED');
  journal.recordStep('act-2', 'FAILED');

  assert.equal(journal.isStepCompleted('act-1'), true);
  assert.equal(journal.isStepCompleted('act-2'), false);
  assert.deepEqual(journal.getCompletedStepIds(), ['act-1']);
});

test('V96-001 RED: validateExportSurface confirms clean non-redundant export surface in index.ts', () => {
  const validation = validateExportSurface();
  assert.equal(validation.valid, true);
  assert.equal(validation.duplicateExports.length, 0);
  assert.ok(validation.totalExports > 20);
});
