import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  VerificationStatus,
  createEvidenceEnvelope,
  classifyEvidenceAuthenticity,
  promoteStatus,
  EvidenceTrustPolicy
} from '../dist/status.js';
import { evaluateAcceptance } from '../dist/acceptance.js';
import { createDispatch, preflightDispatch, DispatchStatus } from '../dist/dispatch.js';
import { executeOnce } from '../dist/executor.js';
import { SideEffectClass, AdapterAvailability, ExecutionResultStatus } from '../dist/adapter.js';
import { AuthorityLevel } from '../dist/authority.js';
import { MemoryRepository, MemoryEventType } from '../dist/memory.js';
import { createNodeMemoryTextStore } from '../node-adapters.mjs';
import { ContextFreshness } from '../dist/context.js';

test('FINDING 1: Untrusted evidence envelope with valid checksum cannot promote to RUNTIME_VERIFIED', () => {
  const policy = new EvidenceTrustPolicy({ trustedSources: ['trusted-ci-system'] });
  const attackerEnvelope = createEvidenceEnvelope({
    kind: 'security-scan',
    ref: 'repo-root',
    source: 'attacker',
    payload: { passed: true }
  });

  const auth = classifyEvidenceAuthenticity(attackerEnvelope, ['trusted-ci-system']);
  assert.equal(auth.checksumValid, true);
  assert.equal(auth.status, 'AUTHENTICITY_UNKNOWN');

  assert.throws(
    () => promoteStatus(VerificationStatus.DRAFT, VerificationStatus.RUNTIME_VERIFIED, [attackerEnvelope], policy),
    (err) => err instanceof Error && err.message.includes('not trusted')
  );
});

test('FINDING 1: Bare evidence without trusted provenance, ID, timestamp, and integrity cannot pass acceptance', () => {
  const policy = new EvidenceTrustPolicy({ trustedSources: ['trusted-source'] });
  const bareEvidence = [{ kind: 'criterion', ref: 'build passed' }];

  const result = evaluateAcceptance(['build passed'], bareEvidence, policy);
  assert.equal(result.passed, false, 'Bare evidence must not pass acceptance by default');
});

test('FINDING 2: Non-idempotent mutating adapter dispatches without full preflight are rejected and not executed', async () => {
  let invokedCount = 0;
  const mockAdapter = {
    id: 'db-writer',
    capability: 'db.write',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.NON_IDEMPOTENT_MUTATION,
    async invoke() {
      invokedCount++;
      return { status: ExecutionResultStatus.SUCCEEDED, output: 'written', evidence: [] };
    }
  };

  const registry = {
    get(id) {
      return id === 'db-writer' ? mockAdapter : undefined;
    }
  };

  const dispatchInput = {
    id: 'disp-1',
    capability: 'db.write',
    adapterId: 'db-writer',
    input: { query: 'DELETE FROM users' }
  };

  const preflight = preflightDispatch({
    dispatch: dispatchInput,
    adapters: registry,
    actorAuthority: AuthorityLevel.USER,
    idempotencyKey: null
  });
  assert.equal(preflight.eligible, false);

  const rawDispatch = createDispatch(dispatchInput, registry);
  const execResult = await executeOnce(rawDispatch, registry);

  assert.equal(execResult.status, ExecutionResultStatus.NOT_PERFORMED);
  assert.equal(invokedCount, 0, 'Mutating adapter invocation count must remain 0 when preflight is bypassed');
});

test('FINDING 3: Simultaneous memory writers with expectedVersion=0 do not suffer lost updates', async () => {
  const testDir = resolve(process.cwd(), 'scratch/test-memory-race-' + randomUUID());
  const filePath = resolve(testDir, 'memory.json');

  const storeA = createNodeMemoryTextStore(filePath);
  const storeB = createNodeMemoryTextStore(filePath);

  const repoA = new MemoryRepository(storeA);
  const repoB = new MemoryRepository(storeB);

  const historyA = await repoA.history();
  const historyB = await repoB.history();
  assert.equal(historyA.length, 0);
  assert.equal(historyB.length, 0);

  const record1 = {
    id: 'rec-1',
    key: 'user.preference',
    value: 'dark-mode',
    freshness: ContextFreshness.FRESH,
    priority: 10,
    provenance: { kind: 'user-input', ref: 'ui-settings' }
  };

  const record2 = {
    id: 'rec-2',
    key: 'user.preference',
    value: 'light-mode',
    freshness: ContextFreshness.FRESH,
    priority: 10,
    provenance: { kind: 'user-input', ref: 'ui-settings' }
  };

  const p1 = repoA.put({ eventId: 'evt-1', record: record1, expectedVersion: 0 });
  const p2 = repoB.put({ eventId: 'evt-2', record: record2, expectedVersion: 0 });

  const results = await Promise.allSettled([p1, p2]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one writer must commit when expectedVersion=0');
  assert.equal(rejected.length, 1, 'The other writer must be rejected with concurrency conflict');

  const errorReason = rejected[0].reason;
  assert.match(String(errorReason), /MEMORY_CONCURRENCY_CONFLICT|LOCK_ACQUISITION_FAILED/);

  const finalRepo = new MemoryRepository(storeA);
  const finalHistory = await finalRepo.history();
  assert.equal(finalHistory.length, 1, 'Final store history must contain exactly 1 event');

  await rm(testDir, { recursive: true, force: true });
});
