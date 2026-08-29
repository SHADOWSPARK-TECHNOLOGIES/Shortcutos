import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AuthorityLevel,
  SideEffectClass,
  createDispatch,
  executeOnce,
  ToolAdapterRegistry,
  AdapterAvailability,
  ExecutionResultStatus,
  MemoryRepository,
  ContextFreshness,
  VerificationStatus,
  ShortcutOSKernel,
  createEvidenceEnvelope,
  promoteStatus,
  EvidenceTrustPolicy,
  extractClaimsFromEvidence,
  restoreFromCheckpoint,
  compressContext,
  reconcileStateDrift,
  createSpecialist,
  SpecialistRole,
  executeSpecialistHandoff,
  executeRecoveryPlan,
  selectMinimalRepairPlan,
  RecoveryJournal,
  validateExportSurface
} from '../dist/index.js';
import { createNodeMemoryTextStore } from '../node-adapters.mjs';

// ==================================================
// RED TEST 1: SYSTEM-OWNED EVIDENCE TRUST (NO CALLER-FORGED TRUST POLICY)
// ==================================================
test('RED TEST 1: Caller cannot forge EvidenceTrustPolicy with attacker sources without system authority boundary', () => {
  const attackerEnvelope = createEvidenceEnvelope({
    kind: 'test-evidence',
    ref: 'att-1',
    source: 'attacker',
    payload: { malicious: true }
  });

  assert.throws(
    () => {
      const forgedPolicy = new EvidenceTrustPolicy({
        trustedSources: ['attacker']
      });
      promoteStatus(
        VerificationStatus.RUNTIME_EXECUTED,
        VerificationStatus.RUNTIME_VERIFIED,
        [attackerEnvelope],
        forgedPolicy
      );
    },
    (err) => err instanceof Error && (err.message.includes('SYSTEM_TRUST_BOUNDARY_REQUIRED') || err.message.includes('FORGED_TRUST_POLICY'))
  );
});

// ==================================================
// RED TEST 2: NON-FORGEABLE EXECUTION AUTHORIZATION
// ==================================================
test('RED TEST 2: Manually constructed READY_FOR_EXECUTION dispatch without preflight authorization is rejected by executeOnce()', async () => {
  const registry = new ToolAdapterRegistry();
  let invocationCount = 0;

  registry.register({
    id: 'writer.adapter',
    capability: 'file.write',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.NON_IDEMPOTENT_MUTATION,
    requiredAuthority: AuthorityLevel.USER,
    async invoke() {
      invocationCount++;
      return { status: ExecutionResultStatus.SUCCEEDED, output: null, evidence: [] };
    }
  });

  const forgedDispatch = {
    id: 'dispatch-forged-1',
    capability: 'file.write',
    adapterId: 'writer.adapter',
    input: { path: '/tmp/test.txt' },
    status: 'READY_FOR_EXECUTION',
    blockReason: null
  };

  const res = await executeOnce(forgedDispatch, registry);

  assert.equal(res.status, ExecutionResultStatus.NOT_PERFORMED);
  assert.equal(invocationCount, 0, 'Adapter must NOT be invoked when preflight authorization is missing');
  assert.equal(res.error?.code, 'PREFLIGHT_AUTHORIZATION_REQUIRED');
});

// ==================================================
// RED TEST 3: MEMORY LEASE FENCING (EXPIRED WRITER CANNOT COMMIT)
// ==================================================
test('RED TEST 3: Expired writer cannot commit after lease expiration and fencing outrank', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shortcutos-fencing-test-'));
  const filePath = join(dir, 'memory.json');
  try {
    const storeA = createNodeMemoryTextStore(filePath);
    const storeB = createNodeMemoryTextStore(filePath);

    await assert.rejects(
      async () => {
        await storeA.withLock(async (txA) => {
          await new Promise((r) => setTimeout(r, 70));

          const lockB = await storeB.acquireLock({ ownerToken: 'writer-B', leaseMs: 1000 });
          await storeB.write(JSON.stringify([{ eventId: 'evt-B', type: 'PUT' }]));
          await lockB.release();

          await txA.write(JSON.stringify([{ eventId: 'evt-A', type: 'PUT' }]));
        }, { ownerToken: 'writer-A', leaseMs: 50 });
      },
      (err) => err instanceof Error && (err.message.includes('LOCK_FENCING_STALE') || err.message.includes('FENCING_TOKEN_STALE'))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ==================================================
// RED TEST 4: INVALID V58 CHECKPOINT RESTORATION
// ==================================================
test('RED TEST 4: Invalid V58 checkpoint integrity or missing precondition rejects restoration', () => {
  const tamperedCheckpoint = {
    id: 'chk-1',
    timestamp: new Date().toISOString(),
    entries: [{ id: 'rec-1', key: 'k1', value: 'v1', freshness: ContextFreshness.FRESH, priority: 1 }],
    checksum: 'tampered-checksum',
    dependencies: ['chk-0'],
    status: 'CORRUPTED'
  };

  assert.throws(
    () => {
      restoreFromCheckpoint(tamperedCheckpoint, { verifiedCheckpoints: [] });
    },
    (err) => err instanceof Error && (err.message.includes('CHECKPOINT_INTEGRITY_INVALID') || err.message.includes('CHECKPOINT_PRECONDITION_FAILED'))
  );
});

// ==================================================
// RED TEST 5: V59 COMPRESSION BUDGET AND SALIENCE INVARIANTS
// ==================================================
test('RED TEST 5: V59 compression strictly respects token budget and preserves high-salience decisions', () => {
  const entries = [
    { id: 'e1', key: 'decision.architecture', value: 'use-event-sourcing', freshness: ContextFreshness.FRESH, priority: 10, salience: 'HIGH_CRITICAL_DECISION' },
    { id: 'e2', key: 'log.debug.1', value: 'A'.repeat(500), freshness: ContextFreshness.FRESH, priority: 1, salience: 'LOW_DETAIL' },
    { id: 'e3', key: 'constraint.security', value: 'no-root-execution', freshness: ContextFreshness.FRESH, priority: 10, salience: 'HIGH_CONSTRAINT' }
  ];

  const targetBudgetTokens = 50;
  const result = compressContext(entries, { targetBudgetTokens });

  assert.ok(result.summary.compressedTokenCount <= targetBudgetTokens, `Compressed token count ${result.summary.compressedTokenCount} exceeds target budget ${targetBudgetTokens}`);
  assert.ok(result.preservedInvariants.includes('decision.architecture'), 'High salience critical decision must be preserved');
  assert.ok(result.preservedInvariants.includes('constraint.security'), 'High salience constraint must be preserved');
});

// ==================================================
// RED TEST 6: ORIGINAL V43 CLAIM EXTRACTION & CLASSIFICATION
// ==================================================
test('RED TEST 6: Canonical V43 extracts typed claims with statement classifications and fingerprints', () => {
  const envelope = createEvidenceEnvelope({
    kind: 'analysis',
    ref: 'spec-1',
    source: 'analyzer',
    payload: {
      findings: [
        { statement: 'System latency is under 10ms', claimType: 'numeric', subject: 'latency', predicate: 'is_under', quantifier: '10ms' },
        { statement: 'We recommend adopting event sourcing', claimType: 'recommendation', subject: 'architecture', predicate: 'adopt_event_sourcing' }
      ]
    }
  });

  const claims = extractClaimsFromEvidence(envelope);
  assert.ok(claims.length >= 2);
  assert.equal(claims[0].claimType, 'numeric');
  assert.equal(claims[1].claimType, 'recommendation');
  assert.ok(typeof claims[0].fingerprint === 'string' && claims[0].fingerprint.length > 0);
});

// ==================================================
// RED TEST 7: ORIGINAL V68 DRIFT RECONCILIATION
// ==================================================
test('RED TEST 7: Canonical V68 performs multi-dimensional drift analysis (goal, artifact, dependency)', () => {
  const checkpointState = {
    goal: 'deploy-v1',
    artifacts: [{ path: 'dist/index.js', hash: 'h1' }],
    dependencies: [{ id: 'dep-1', version: '1.0.0' }]
  };
  const currentState = {
    goal: 'deploy-v2',
    artifacts: [{ path: 'dist/index.js', hash: 'h2' }],
    dependencies: [{ id: 'dep-1', version: '2.0.0' }]
  };

  const drift = reconcileStateDrift(checkpointState, currentState);
  assert.ok(drift.goalDrift !== null);
  assert.ok(drift.artifactDrift.length > 0);
  assert.ok(drift.dependencyDrift.length > 0);
  assert.equal(drift.hasBlockers, true);
});

// ==================================================
// RED TEST 8: ORIGINAL V72-V79 DOMAIN CONTRACTS
// ==================================================
test('RED TEST 8: Canonical V72-V79 specialists possess typed domain contracts', () => {
  const research = createSpecialist(SpecialistRole.RESEARCH);
  assert.ok(research.domainContract !== undefined);
  assert.equal(research.domainContract.kind, 'ResearchTaskContract');

  const engineering = createSpecialist(SpecialistRole.SOFTWARE_ENGINEERING);
  assert.ok(engineering.domainContract !== undefined);
  assert.equal(engineering.domainContract.kind, 'CodeContextContract');
});

// ==================================================
// RED TEST 9: ORIGINAL V83 DOMAIN POLICY BINDING & CONFLICTS
// ==================================================
test('RED TEST 9: Canonical V83 evaluates domain policy profiles and side effect boundaries', () => {
  const researchSpec = createSpecialist(SpecialistRole.RESEARCH);
  const securitySpec = createSpecialist(SpecialistRole.SECURITY);

  assert.throws(
    () => {
      executeSpecialistHandoff(researchSpec, securitySpec, {
        restrictedOperation: 'BYPASS_AUTH',
        sideEffectBoundary: 'READ_ONLY'
      });
    },
    (err) => err instanceof Error && (err.message.includes('DOMAIN_POLICY_CONFLICT') || err.message.includes('RESTRICTED_OPERATION_VIOLATION'))
  );
});

// ==================================================
// RED TEST 10: ORIGINAL V89 RECOVERY CHECKPOINT & RESTORE PLAN
// ==================================================
test('RED TEST 10: Canonical V89 evaluates restore plans and checkpoint compatibility', async () => {
  const plan = await executeRecoveryPlan({
    partialState: { completedSteps: ['s1'], failedStep: 's2' },
    targetCheckpoint: { id: 'chk-1', compatibilityVersion: 'V100' }
  });

  assert.ok(plan.restorePlan !== undefined);
  assert.equal(plan.restoreResult.status, 'RESTORED');
});

// ==================================================
// RED TEST 11: ORIGINAL V92 MINIMAL REPAIR SELECTION
// ==================================================
test('RED TEST 11: Canonical V92 selects minimal repair candidate by cost and risk class', () => {
  const candidates = [
    { id: 'repair-heavy', costClass: 'HIGH', riskClass: 'HIGH', actions: ['rebuild-all', 'clear-cache'] },
    { id: 'repair-minimal', costClass: 'LOW', riskClass: 'LOW', actions: ['rebuild-single-module'] }
  ];

  const selection = selectMinimalRepairPlan(candidates);
  assert.equal(selection.selectedCandidateId, 'repair-minimal');
});

// ==================================================
// RED TEST 12: ORIGINAL V93 RESUMABLE RECOVERY JOURNAL
// ==================================================
test('RED TEST 12: Canonical V93 RecoveryJournal maintains immutable resumable step history', () => {
  const journal = new RecoveryJournal();
  journal.recordAttempt({ stepId: 'step-1', status: 'SUCCESS', resultRef: 'ref-1' });

  assert.throws(
    () => {
      journal.recordAttempt({ stepId: 'step-1', status: 'FAILED', resultRef: 'ref-2' });
    },
    (err) => err instanceof Error && err.message.includes('RECOVERY_JOURNAL_IMMUTABLE')
  );
});

// ==================================================
// RED TEST 13: ORIGINAL V96 CANONICAL SURFACE DEDUPLICATION
// ==================================================
test('RED TEST 13: Canonical V96 performs whole-system surface analysis and namespace minimization', () => {
  const surfaceAnalysis = validateExportSurface();
  assert.ok(surfaceAnalysis.canonicalSurface !== undefined);
  assert.ok(surfaceAnalysis.canonicalSurface.namespaceMinimization === true);
  assert.ok(surfaceAnalysis.canonicalSurface.aliasCompression === true);
});
