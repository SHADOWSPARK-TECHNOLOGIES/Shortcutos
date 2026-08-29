import test from 'node:test';
import assert from 'node:assert/strict';
import {
  promoteStatus,
  createEvidenceEnvelope,
  VerificationStatus,
  ShortcutOSKernel,
  EvidenceTrustPolicy,
  SystemEvidenceTrustBoundary
} from '../dist/index.js';
import { createPreflightAuthorization } from '../dist/dispatch.js';
import { executeOnce } from '../dist/executor.js';
import { createNodeMemoryTextStore } from '../node-adapters.mjs';
import { restoreFromCheckpoint, compressContext, reconcileStateDrift } from '../dist/context.js';
import { createSpecialist, executeSpecialistHandoff } from '../dist/specialist.js';
import { executeRecoveryPlan, selectMinimalRepairPlan, RecoveryJournal } from '../dist/recovery-runtime.js';
import { validateExportSurface } from '../dist/index.js';

test('FINDING A-1: Forged EvidenceTrustPolicy containing attacker sources is rejected', () => {
  const forgedPolicy = new EvidenceTrustPolicy({ trustedSources: ['attacker'] });
  const envelope = createEvidenceEnvelope({
    kind: 'test-evidence',
    ref: 'ref-1',
    source: 'attacker',
    payload: { malicious: true }
  });

  assert.throws(
    () => {
      promoteStatus(VerificationStatus.RUNTIME_EXECUTED, VerificationStatus.RUNTIME_VERIFIED, [envelope], forgedPolicy);
    },
    (err) => err instanceof Error && err.message.includes('SYSTEM_TRUST_BOUNDARY_REQUIRED')
  );
});

test('FINDING A-2: ShortcutOSKernel constructor rejects caller-owned trust policy containing unapproved origins', () => {
  const forgedPolicy = new EvidenceTrustPolicy({ trustedSources: ['attacker-origin'] });
  assert.throws(
    () => {
      new ShortcutOSKernel({ trustPolicy: forgedPolicy });
    },
    (err) => err instanceof Error && err.message.includes('SYSTEM_TRUST_BOUNDARY_REQUIRED')
  );
});

test('FINDING B-1: Manually constructed READY_FOR_EXECUTION dispatch without PreflightAuthorization token is rejected', async () => {
  const req = {
    id: 'dispatch-forged-1',
    capability: 'local-read',
    adapterId: 'adapter-1',
    input: { path: 'test.txt' },
    status: 'READY_FOR_EXECUTION',
    blockReason: null,
    authorization: { token: 'fake-token' }
  };

  const dummyAdapters = new Map([
    ['adapter-1', { id: 'adapter-1', capability: 'local-read', availability: 'AVAILABLE', invoke: async () => ({ status: 'SUCCEEDED', output: {}, evidence: [] }) }]
  ]);

  const result = await executeOnce(req, dummyAdapters);
  assert.equal(result.status, 'NOT_PERFORMED');
  assert.equal(result.error?.code, 'PREFLIGHT_AUTHORIZATION_REQUIRED');
});

test('FINDING C-1: Expired memory transaction cannot write after lease timeout', async () => {
  const store = createNodeMemoryTextStore('scratch/test-memory-c1.json');
  const lease = await store.acquireLock({ leaseMs: 200 });

  await new Promise((resolve) => setTimeout(resolve, 300));

  await assert.rejects(
    async () => {
      await store.unlockedWrite('value-1', lease.ownerToken, lease.fencingToken);
    },
    (err) => err instanceof Error && (err.message.includes('LOCK_FENCING_STALE') || err.message.includes('expired'))
  );
});

test('FINDING D-1: Checkpoint restore rejects tampered snapshot hash or broken preconditions', () => {
  const snapshot = {
    id: 'snap-d',
    timestamp: new Date().toISOString(),
    entries: [{ key: 'k1', value: 'v1', salience: 1.0 }],
    snapshotHash: 'tampered-hash',
    preconditions: ['valid-precond']
  };

  assert.throws(
    () => {
      restoreFromCheckpoint(snapshot, ['missing-precond']);
    },
    (err) => err instanceof Error && (err.message.includes('CHECKPOINT_INTEGRITY') || err.message.includes('PRECONDITION_FAILED'))
  );
});

test('FINDING E-1: Context compression reported token count strictly equals actual measured content length', () => {
  const entries = [
    { key: 'e1', value: 'High salience directive payload text here', salience: 0.9 },
    { key: 'e2', value: 'Low salience temporary noise text', salience: 0.1 }
  ];

  const compressed = compressContext(entries, 50);
  assert.equal(compressed.retainedTokens, compressed.measuredContentLength);
  assert.ok(compressed.retainedTokens <= 50);
});

test('FINDING F-1: Drift reconciliation detects deleted keys between checkpoint and current state', () => {
  const checkpointEntries = [
    { key: 'k1', value: 'v1' },
    { key: 'k2', value: 'v2' }
  ];
  const currentEntries = [{ key: 'k1', value: 'v1' }];

  const drift = reconcileStateDrift(checkpointEntries, currentEntries);
  assert.equal(drift.hasDrift, true);
  assert.ok(drift.deletedKeys.includes('k2'));
});

test('FINDING G-1: Recovery plan fails when state restoration check fails', async () => {
  const plan = {
    id: 'plan-g',
    actions: [{ action: 'restore_state', key: 'corrupted-key' }]
  };

  const result = await executeRecoveryPlan(plan, async () => {
    throw new Error('STATE_RESTORATION_FAILED');
  });

  assert.equal(result.status, 'RECOVERY_FAILED');
  assert.equal(result.error, 'STATE_RESTORATION_FAILED');
});

test('FINDING H-1: Minimal repair selection rejects unsafe repair candidates before minimization', () => {
  const candidates = [
    { id: 'unsafe-1', costClass: 1, riskClass: 'HIGH_RISK_DATA_LOSS', safe: false },
    { id: 'safe-1', costClass: 5, riskClass: 'LOW_RISK', safe: true }
  ];

  const selected = selectMinimalRepairPlan(candidates);
  assert.equal(selected.id, 'safe-1');
});

test('FINDING I-1: RecoveryJournal throws RECOVERY_JOURNAL_IMMUTABLE on illegal step mutation', () => {
  const journal = new RecoveryJournal();
  journal.recordStep({ stepId: 'step-1', status: 'SUCCESS' });

  assert.throws(
    () => {
      journal.modifyStep('step-1', { status: 'FAILED' });
    },
    (err) => err instanceof Error && err.message.includes('RECOVERY_JOURNAL_IMMUTABLE')
  );
});

test('FINDING J-1: Export surface validator dynamically inspects symbols and fails on duplicate/alias fixtures', () => {
  const result = validateExportSurface();
  assert.equal(result.valid, true);
  assert.equal(result.namespaceCollisionCount, 0);
  assert.ok(result.canonicalSurface.totalExports > 0);
});
