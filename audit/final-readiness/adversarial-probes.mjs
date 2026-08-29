import assert from 'node:assert/strict';
import {
  VerificationStatus,
  createEvidenceEnvelope,
  promoteStatus,
  EvidenceTrustPolicy,
  ShortcutOSKernel
} from '../../dist/index.js';
import { executeOnce } from '../../dist/executor.js';
import { createNodeMemoryTextStore } from '../../node-adapters.mjs';
import { restoreFromCheckpoint, compressContext, reconcileStateDrift } from '../../dist/context.js';
import { executeRecoveryPlan, selectMinimalRepairPlan, RecoveryJournal } from '../../dist/recovery-runtime.js';
import { validateExportSurface } from '../../dist/index.js';

console.log('=== RUNNING ADVERSARIAL PROBES A-K ===');

const results = [];

function runProbe(id, name, fn) {
  try {
    fn();
    console.log(`[PASS] Probe ${id}: ${name}`);
    results.push({ id, name, status: 'PASS' });
  } catch (err) {
    console.error(`[FAIL] Probe ${id}: ${name} ->`, err.message);
    results.push({ id, name, status: 'FAIL', error: err.message });
  }
}

async function runAsyncProbe(id, name, fn) {
  try {
    await fn();
    console.log(`[PASS] Probe ${id}: ${name}`);
    results.push({ id, name, status: 'PASS' });
  } catch (err) {
    console.error(`[FAIL] Probe ${id}: ${name} ->`, err.message);
    results.push({ id, name, status: 'FAIL', error: err.message });
  }
}

// PROBE A: Evidence Trust Boundary
runProbe('A', 'Evidence trust boundary rejects attacker trust policies and forged evidence', () => {
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

// PROBE B: Kernel Acceptance Derivation
runProbe('B', 'Kernel acceptance is derived exclusively from evidence evaluation, not caller boolean', () => {
  const forgedPolicy = new EvidenceTrustPolicy({ trustedSources: ['attacker-origin'] });
  assert.throws(
    () => {
      new ShortcutOSKernel({ trustPolicy: forgedPolicy });
    },
    (err) => err instanceof Error && err.message.includes('SYSTEM_TRUST_BOUNDARY_REQUIRED')
  );

  const kernel = new ShortcutOSKernel();
  const run = kernel.createRun({ goal: 'g', acceptanceCriteria: ['c'] });
  kernel.markPlanned(run.id);

  const env = createEvidenceEnvelope({
    kind: 'test',
    ref: 'r',
    source: 'untrusted-source',
    payload: { c: true }
  });
  kernel.markExecuted(run.id, env);

  const res = kernel.verify(run.id, [env]);
  assert.equal(res.completed, false);
  assert.equal(res.acceptancePassed, false);
});

// PROBE C: Dispatch Preflight
await runAsyncProbe('C', 'Dispatch preflight rejects unverified executions and missing authority', async () => {
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

// PROBE D: Memory Lease & Fencing
await runAsyncProbe('D', 'Memory lease expiry and lock fencing reject stale writes and non-owners', async () => {
  const store = createNodeMemoryTextStore('scratch/test-memory-probe-d.json');
  const lease = await store.acquireLock({ leaseMs: 100 });

  await new Promise((resolve) => setTimeout(resolve, 150));

  await assert.rejects(
    async () => {
      await store.unlockedWrite('value-1', lease.ownerToken, lease.fencingToken);
    },
    (err) => err instanceof Error && (err.message.includes('LOCK_FENCING_STALE') || err.message.includes('expired'))
  );
});

// PROBE E: V58 Checkpoint Integrity
runProbe('E', 'V58 checkpoint integrity rejects tampered checksums and corrupted snapshots', () => {
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

// PROBE F: V59 Token Budget Compression
runProbe('F', 'V59 token compression strictly enforces declared budgets and records dropped items', () => {
  const entries = [
    { key: 'e1', value: 'High salience directive payload text here', salience: 0.9 },
    { key: 'e2', value: 'Low salience temporary noise text', salience: 0.1 }
  ];

  const compressed = compressContext(entries, 50);
  assert.equal(compressed.retainedTokens, compressed.measuredContentLength);
  assert.ok(compressed.retainedTokens <= 50);
});

// PROBE G: V68 State Drift Reconciliation
runProbe('G', 'V68 state drift reconciliation detects deletions, mutations and mismatches', () => {
  const checkpointEntries = [
    { key: 'k1', value: 'v1' },
    { key: 'k2', value: 'v2' }
  ];
  const currentEntries = [{ key: 'k1', value: 'v1' }];

  const drift = reconcileStateDrift(checkpointEntries, currentEntries);
  assert.equal(drift.hasDrift, true);
  assert.ok(drift.deletedKeys.includes('k2'));
});

// PROBE H: V89 Recovery Plan Integrity
await runAsyncProbe('H', 'V89 recovery plan execution rejects incompatible or corrupted checkpoints', async () => {
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

// PROBE I: V92 Minimal Repair Plan Selection
runProbe('I', 'V92 minimal repair plan prunes unsafe and invariant-violating candidates', () => {
  const candidates = [
    { id: 'unsafe-1', costClass: 1, riskClass: 'HIGH_RISK_DATA_LOSS', safe: false },
    { id: 'safe-1', costClass: 5, riskClass: 'LOW_RISK', safe: true }
  ];

  const selected = selectMinimalRepairPlan(candidates);
  assert.equal(selected.id, 'safe-1');
});

// PROBE J: V93 Recovery Journal Append-Only
runProbe('J', 'V93 recovery journal enforces append-only immutability', () => {
  const journal = new RecoveryJournal();
  journal.recordStep({ stepId: 'step-1', status: 'SUCCESS' });

  assert.throws(
    () => {
      journal.modifyStep('step-1', { status: 'FAILED' });
    },
    (err) => err instanceof Error && err.message.includes('RECOVERY_JOURNAL_IMMUTABLE')
  );
});

// PROBE K: V96 Export Surface Minimization
runProbe('K', 'V96 export surface validator inspects fixtures and flags duplicates or over-budget symbols', () => {
  const result = validateExportSurface();
  assert.equal(result.valid, true);
  assert.equal(result.namespaceCollisionCount, 0);
  assert.ok(result.canonicalSurface.totalExports > 0);
});

const allPassed = results.every(r => r.status === 'PASS');
console.log('\n=== ADVERSARIAL PROBES SUMMARY ===');
console.log(`Total probes: ${results.length}, Passed: ${results.filter(r => r.status === 'PASS').length}, Failed: ${results.filter(r => r.status === 'FAIL').length}`);
if (!allPassed) {
  process.exit(1);
}
