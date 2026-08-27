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
  EvidenceTrustPolicy
} from '../dist/index.js';
import { createNodeMemoryTextStore } from '../node-adapters.mjs';

// ==================================================
// FINDING A — MEMORY LOCK SELF-DEADLOCK & TOKEN LEASE
// ==================================================

test('FINDING A1: Single repository put succeeds quickly without self-deadlock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shortcutos-lock-test-'));
  const filePath = join(dir, 'memory.json');
  try {
    const store = createNodeMemoryTextStore(filePath);
    const repo = new MemoryRepository(store);

    const start = Date.now();
    await repo.put({
      eventId: 'evt-single-1',
      record: {
        id: 'rec-1',
        key: 'config.theme',
        value: 'dark',
        freshness: ContextFreshness.FRESH,
        priority: 1,
        provenance: { kind: 'test', ref: 'init' }
      }
    });
    const duration = Date.now() - start;
    assert.ok(duration < 1000, `put() took ${duration}ms, expected < 1000ms (no self-deadlock)`);
    assert.equal(repo.version, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FINDING A2: Sequential put and read operations succeed cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shortcutos-lock-test-'));
  const filePath = join(dir, 'memory.json');
  try {
    const store = createNodeMemoryTextStore(filePath);
    const repo = new MemoryRepository(store);

    await repo.put({
      eventId: 'evt-seq-1',
      record: {
        id: 'rec-1',
        key: 'k1',
        value: 'v1',
        freshness: ContextFreshness.FRESH,
        priority: 1,
        provenance: { kind: 'test', ref: 'init' }
      }
    });

    const activeRecords = await repo.getActiveRecords();
    assert.equal(activeRecords.length, 1);
    assert.equal(activeRecords[0].value, 'v1');

    await repo.put({
      eventId: 'evt-seq-2',
      record: {
        id: 'rec-2',
        key: 'k2',
        value: 'v2',
        freshness: ContextFreshness.FRESH,
        priority: 1,
        provenance: { kind: 'test', ref: 'init' }
      }
    });

    assert.equal(repo.version, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FINDING A3: Two repository instances with expectedVersion=0 yield 1 commit and 1 MEMORY_CONCURRENCY_CONFLICT', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shortcutos-lock-test-'));
  const filePath = join(dir, 'memory.json');
  try {
    const storeA = createNodeMemoryTextStore(filePath);
    const storeB = createNodeMemoryTextStore(filePath);

    const repoA = new MemoryRepository(storeA);
    const repoB = new MemoryRepository(storeB);

    const p1 = repoA.put({
      eventId: 'evt-conc-1',
      expectedVersion: 0,
      record: {
        id: 'rec-1',
        key: 'user.lang',
        value: 'en',
        freshness: ContextFreshness.FRESH,
        priority: 1,
        provenance: { kind: 'user', ref: 'setting' }
      }
    });

    const p2 = repoB.put({
      eventId: 'evt-conc-2',
      expectedVersion: 0,
      record: {
        id: 'rec-2',
        key: 'user.lang',
        value: 'fr',
        freshness: ContextFreshness.FRESH,
        priority: 1,
        provenance: { kind: 'user', ref: 'setting' }
      }
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exactly one put() must commit when expectedVersion=0');
    assert.equal(rejected.length, 1, 'The concurrent writer must be rejected with concurrency conflict');

    const err = rejected[0].reason;
    assert.equal(err?.shortcut?.code, 'MEMORY_CONCURRENCY_CONFLICT');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FINDING A4: Non-owner cannot release another owner lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shortcutos-lock-test-'));
  const filePath = join(dir, 'memory.json');
  try {
    const store = createNodeMemoryTextStore(filePath);
    await store.acquireLock({ ownerToken: 'owner-token-A', leaseMs: 10000 });

    // Attempt release with wrong token
    await assert.rejects(
      async () => {
        await store.releaseLock('wrong-token-B');
      },
      (err) => err instanceof Error && err.message.includes('LOCK_NON_OWNER_RELEASE_FORBIDDEN')
    );

    // Clean release with owner token
    await store.releaseLock('owner-token-A');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ==================================================
// FINDING B — TRUST ROOT IS NOT CALLER CONTROLLED
// ==================================================

test('FINDING B: Caller passing ["attacker"] in promoteStatus cannot declare attacker trusted', () => {
  const systemPolicy = new EvidenceTrustPolicy({ trustedSources: ['ci-runner', 'system'] });
  const attackerEnvelope = createEvidenceEnvelope({
    kind: 'test-evidence',
    ref: 'att-1',
    source: 'attacker',
    payload: { fake: true }
  });

  // Attempting to promote with system policy must throw error
  assert.throws(
    () => {
      promoteStatus(VerificationStatus.RUNTIME_EXECUTED, VerificationStatus.RUNTIME_VERIFIED, [attackerEnvelope], systemPolicy);
    },
    (err) => err instanceof Error && err.message.includes('not trusted')
  );

  // Passing raw string array ["attacker"] instead of EvidenceTrustPolicy instance is rejected
  assert.throws(
    () => {
      promoteStatus(VerificationStatus.RUNTIME_EXECUTED, VerificationStatus.RUNTIME_VERIFIED, [attackerEnvelope], ['attacker']);
    },
    (err) => err instanceof Error && err.message.includes('EvidenceTrustPolicy')
  );
});

// ==================================================
// FINDING C — ACCEPTANCE REMAINS SYSTEM CONTROLLED (NO NAKED BOOLEAN)
// ==================================================

test('FINDING C: Kernel verify() ignores naked boolean and derives acceptance from criteria, evidence and EvidenceTrustPolicy', () => {
  const trustPolicy = new EvidenceTrustPolicy({ trustedSources: ['ci-runner'] });
  const kernel = new ShortcutOSKernel({ trustPolicy });

  // Run 1: Verification with untrusted evidence fails closed
  const runUntrusted = kernel.createRun({ goal: 'g1', acceptanceCriteria: ['build must pass'] });
  kernel.markPlanned(runUntrusted.id);
  const execEvidence1 = createEvidenceEnvelope({
    kind: 'build-log',
    ref: 'b1',
    source: 'ci-runner',
    payload: { executionState: 'completed' }
  });
  kernel.markExecuted(runUntrusted.id, execEvidence1);

  const untrustedEvidence = createEvidenceEnvelope({
    kind: 'untrusted-check',
    ref: 'u1',
    source: 'unknown-source',
    payload: { criteria: 'build must pass', satisfied: true }
  });

  const resUntrusted = kernel.verify(runUntrusted.id, [untrustedEvidence]);
  assert.equal(resUntrusted.completed, false);
  assert.equal(resUntrusted.acceptancePassed, false);

  // Run 2: Verification with trusted criteria evidence succeeds
  const runTrusted = kernel.createRun({ goal: 'g2', acceptanceCriteria: ['build must pass'] });
  kernel.markPlanned(runTrusted.id);
  const execEvidence2 = createEvidenceEnvelope({
    kind: 'build-log',
    ref: 'b2',
    source: 'ci-runner',
    payload: { executionState: 'completed' }
  });
  kernel.markExecuted(runTrusted.id, execEvidence2);

  const validCriteriaEvidence = createEvidenceEnvelope({
    kind: 'criteria-check',
    ref: 'c1',
    source: 'ci-runner',
    payload: { criteria: 'build must pass', satisfied: true }
  });

  const resTrusted = kernel.verify(runTrusted.id, [validCriteriaEvidence]);
  assert.equal(resTrusted.completed, true);
  assert.equal(resTrusted.acceptancePassed, true);
  assert.equal(resTrusted.verificationStatus, VerificationStatus.RUNTIME_VERIFIED);
});

// ==================================================
// FINDING D — MISSING ACTOR AUTHORITY BLOCKS MUTATION
// ==================================================

test('FINDING D: Missing actorAuthority on mutating operation blocks dispatch with PREFLIGHT_AUTHORITY_UNKNOWN', async () => {
  const registry = new ToolAdapterRegistry();
  let invoked = false;

  registry.register({
    id: 'db.write',
    capability: 'db.update',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.NON_IDEMPOTENT_MUTATION,
    requiredAuthority: AuthorityLevel.USER,
    async invoke() {
      invoked = true;
      return { status: ExecutionResultStatus.SUCCEEDED, output: null, evidence: [] };
    }
  });

  // Missing actorAuthority (undefined)
  const dispatchMissingAuth = createDispatch(
    {
      id: 'd-1',
      capability: 'db.update',
      adapterId: 'db.write',
      input: {}
    },
    registry,
    { idempotencyKey: 'idem-1' } // actorAuthority omitted
  );

  assert.equal(dispatchMissingAuth.status, 'BLOCKED');
  assert.equal(dispatchMissingAuth.blockReason, 'PREFLIGHT_AUTHORITY_UNKNOWN');

  const execResult = await executeOnce(dispatchMissingAuth, registry);
  assert.equal(execResult.status, ExecutionResultStatus.NOT_PERFORMED);
  assert.equal(execResult.error?.code, 'PREFLIGHT_AUTHORITY_UNKNOWN');
  assert.equal(invoked, false);
});
