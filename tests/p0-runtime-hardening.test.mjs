import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AuthorityLevel,
  canOverride,
  createEvidenceEnvelope,
  validateEvidenceEnvelope,
  evaluateAcceptance,
  SideEffectClass,
  preflightDispatch,
  executeOnce,
  ToolAdapterRegistry,
  AdapterAvailability,
  ExecutionResultStatus,
  createDispatch,
  MemoryRepository,
  ContextFreshness,
  VerificationStatus,
  ShortcutOSError,
  ShortcutOSKernel,
  EvidenceTrustPolicy
} from '../dist/index.js';
import { createNodeMemoryTextStore } from '../node-adapters.mjs';

test('P0: Trusted typed RuntimeEvidence envelope creation and integrity validation', () => {
  const envelope = createEvidenceEnvelope({
    kind: 'tool-execution',
    ref: 'local-file-read-001',
    source: 'adapter.node.file.read',
    payload: { bytesRead: 42 },
    verifiedBy: 'system'
  });

  assert.ok(envelope.id);
  assert.ok(envelope.timestamp);
  assert.ok(envelope.integrity);
  assert.equal(envelope.kind, 'tool-execution');
  assert.equal(envelope.verifiedBy, 'system');

  const validResult = validateEvidenceEnvelope(envelope);
  assert.equal(validResult.valid, true);

  // Tampered payload fails integrity
  const tampered = { ...envelope, payload: { bytesRead: 9999 } };
  const tamperedResult = validateEvidenceEnvelope(tampered);
  assert.equal(tamperedResult.valid, false);
  assert.match(tamperedResult.error, /INTEGRITY_MISMATCH/);

  // Missing fields fail validation
  const malformed = { id: 'test' };
  const malformedResult = validateEvidenceEnvelope(malformed);
  assert.equal(malformedResult.valid, false);
});

test('P0: Real acceptance evaluator verifies criteria against validated evidence', () => {
  const trustPolicy = new EvidenceTrustPolicy({ trustedSources: ['file-system'] });
  const criteria = [
    'file must exist on disk',
    'file size must be greater than zero'
  ];

  const evidence = [
    createEvidenceEnvelope({
      kind: 'file-check',
      ref: 'criteria-1',
      source: 'file-system',
      payload: { criteria: 'file must exist on disk', satisfied: true },
      verifiedBy: 'system'
    }),
    createEvidenceEnvelope({
      kind: 'file-size',
      ref: 'criteria-2',
      source: 'file-system',
      payload: { criteria: 'file size must be greater than zero', satisfied: true },
      verifiedBy: 'system'
    })
  ];

  const evaluation = evaluateAcceptance(criteria, evidence, trustPolicy);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.unmetCriteria.length, 0);

  // Partial evidence fails acceptance
  const partialEval = evaluateAcceptance(criteria, [evidence[0]], trustPolicy);
  assert.equal(partialEval.passed, false);
  assert.deepEqual(partialEval.unmetCriteria, ['file size must be greater than zero']);

  // Empty evidence with non-empty criteria is always false
  const emptyEval = evaluateAcceptance(criteria, [], trustPolicy);
  assert.equal(emptyEval.passed, false);
});

test('P0: Full dispatch preflight evaluates authority, capability, side-effect class, and freshness', () => {
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'db.mutation',
    capability: 'database.write',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.NON_IDEMPOTENT_MUTATION,
    requiredAuthority: AuthorityLevel.USER,
    async invoke(input) {
      return {
        status: ExecutionResultStatus.SUCCEEDED,
        output: { updated: true },
        evidence: []
      };
    }
  });

  // Preflight succeeds when all checks pass
  const preflightPass = preflightDispatch({
    dispatch: {
      id: 'disp-001',
      capability: 'database.write',
      adapterId: 'db.mutation',
      input: { sql: 'UPDATE users SET active=1' }
    },
    actorAuthority: AuthorityLevel.USER,
    adapters,
    contextFreshness: ContextFreshness.FRESH,
    hasConflicts: false,
    idempotencyKey: 'idem-123'
  });

  assert.equal(preflightPass.eligible, true);
  assert.equal(preflightPass.reasons.length, 0);

  // Authority escalation blocked: SHORTCUTOS (4) cannot execute USER-level (3) mutation without permission
  const preflightAuthorityBlocked = preflightDispatch({
    dispatch: {
      id: 'disp-002',
      capability: 'database.write',
      adapterId: 'db.mutation',
      input: { sql: 'DROP TABLE users' }
    },
    actorAuthority: AuthorityLevel.SHORTCUTOS,
    adapters,
    contextFreshness: ContextFreshness.FRESH,
    hasConflicts: false,
    idempotencyKey: 'idem-456'
  });

  assert.equal(preflightAuthorityBlocked.eligible, false);
  assert.ok(preflightAuthorityBlocked.reasons.includes('PREFLIGHT_AUTHORITY_INSUFFICIENT'));

  // Stale context blocks mutation dispatch if policy requires fresh context
  const preflightStaleBlocked = preflightDispatch({
    dispatch: {
      id: 'disp-003',
      capability: 'database.write',
      adapterId: 'db.mutation',
      input: { sql: 'UPDATE' }
    },
    actorAuthority: AuthorityLevel.USER,
    adapters,
    contextFreshness: ContextFreshness.STALE,
    hasConflicts: false,
    idempotencyKey: 'idem-789'
  });

  assert.equal(preflightStaleBlocked.eligible, false);
  assert.ok(preflightStaleBlocked.reasons.includes('PREFLIGHT_CONTEXT_STALE'));

  // Non-idempotent mutation without idempotency key is blocked
  const preflightMissingIdem = preflightDispatch({
    dispatch: {
      id: 'disp-004',
      capability: 'database.write',
      adapterId: 'db.mutation',
      input: { sql: 'UPDATE' }
    },
    actorAuthority: AuthorityLevel.USER,
    adapters,
    contextFreshness: ContextFreshness.FRESH,
    hasConflicts: false,
    idempotencyKey: null
  });

  assert.equal(preflightMissingIdem.eligible, false);
  assert.ok(preflightMissingIdem.reasons.includes('PREFLIGHT_IDEMPOTENCY_REQUIRED'));
});

test('P0: Timeout and AbortSignal execution semantics in executeOnce', async () => {
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'slow-adapter',
    capability: 'slow.op',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke(input, options) {
      const signal = options?.abortSignal;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({
            status: ExecutionResultStatus.SUCCEEDED,
            output: 'done',
            evidence: []
          });
        }, 200);

        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('ABORT_ERR'));
          });
        }
      });
    }
  });

  const dispatch = createDispatch({
    id: 'disp-slow',
    capability: 'slow.op',
    adapterId: 'slow-adapter',
    input: {}
  }, adapters);

  // Test timeout
  const timeoutEnvelope = await executeOnce(dispatch, adapters, { timeoutMs: 50 });
  assert.equal(timeoutEnvelope.status, ExecutionResultStatus.FAILED);
  assert.equal(timeoutEnvelope.error?.code, 'EXECUTION_TIMEOUT');

  // Test AbortSignal
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const abortEnvelope = await executeOnce(dispatch, adapters, { abortSignal: controller.signal });
  assert.equal(abortEnvelope.status, ExecutionResultStatus.FAILED);
  assert.equal(abortEnvelope.error?.code, 'EXECUTION_ABORTED');
});

test('P0: Explicit UNKNOWN-side-effect handling after ambiguous timeout on mutations', async () => {
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'mutating-adapter',
    capability: 'remote.transfer',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.NON_IDEMPOTENT_MUTATION,
    async invoke(input, options) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            status: ExecutionResultStatus.SUCCEEDED,
            output: { transferred: true },
            evidence: []
          });
        }, 200);
      });
    }
  });

  const dispatch = createDispatch({
    id: 'disp-mutate',
    capability: 'remote.transfer',
    adapterId: 'mutating-adapter',
    input: { amount: 100 }
  }, adapters, { actorAuthority: AuthorityLevel.USER, contextFreshness: ContextFreshness.FRESH, hasConflicts: false, idempotencyKey: 'idem-123' });

  const envelope = await executeOnce(dispatch, adapters, { timeoutMs: 40 });
  assert.equal(envelope.status, ExecutionResultStatus.UNKNOWN);
  assert.equal(envelope.error?.code, 'EXECUTION_AMBIGUOUS_SIDE_EFFECT');
});

test('P0: Memory journal runtime schema validation and concurrency conflict protection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shortcutos-p0-memory-'));
  const filePath = join(dir, 'memory.json');
  try {
    const store = createNodeMemoryTextStore(filePath);
    const memory = new MemoryRepository(store);

    // Initial put
    await memory.put({
      eventId: 'evt-1',
      record: {
        id: 'rec-1',
        key: 'config.port',
        value: 8080,
        freshness: ContextFreshness.FRESH,
        priority: 1,
        provenance: { kind: 'test', ref: 'init' }
      }
    });

    // Valid state has version 1
    assert.equal(memory.version, 1);

    // Concurrent write simulation with expectedVersion mismatch fails
    await assert.rejects(
      async () => {
        await memory.put({
          eventId: 'evt-2',
          expectedVersion: 0, // stale version expected
          record: {
            id: 'rec-2',
            key: 'config.host',
            value: 'localhost',
            freshness: ContextFreshness.FRESH,
            priority: 1,
            provenance: { kind: 'test', ref: 'init' }
          }
        });
      },
      (err) => err instanceof ShortcutOSError && err.shortcut.code === 'MEMORY_CONCURRENCY_CONFLICT'
    );

    // Invalid schema in journal payload is rejected
    await assert.rejects(
      async () => {
        await memory.put({
          eventId: 'evt-3',
          record: {
            id: '', // invalid empty id
            key: 'config.host',
            value: 'localhost',
            freshness: ContextFreshness.FRESH,
            priority: 1,
            provenance: { kind: 'test', ref: 'init' }
          }
        });
      },
      (err) => err instanceof ShortcutOSError && err.shortcut.code === 'MEMORY_SCHEMA_INVALID'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P0: Adapter registration provenance and trust validation', () => {
  const registry = new ToolAdapterRegistry();

  // System-level registration
  registry.register({
    id: 'system.read',
    capability: 'file.read',
    availability: AdapterAvailability.AVAILABLE,
    registeredBy: 'system',
    authorityLevel: AuthorityLevel.SYSTEM,
    async invoke() {
      return { status: ExecutionResultStatus.SUCCEEDED, output: null, evidence: [] };
    }
  });

  // Attempting to overwrite system adapter from lower authority (SHORTCUTOS) is blocked
  assert.throws(
    () => {
      registry.register({
        id: 'system.read',
        capability: 'file.read',
        availability: AdapterAvailability.AVAILABLE,
        registeredBy: 'shortcutos',
        authorityLevel: AuthorityLevel.SHORTCUTOS,
        async invoke() {
          return { status: ExecutionResultStatus.SUCCEEDED, output: null, evidence: [] };
        }
      });
    },
    (err) => err.message.includes('ADAPTER_ID_COLLISION') || err.message.includes('ADAPTER_AUTHORITY_INSUFFICIENT')
  );
});

test('P0 Adversarial: Execution bypass and blocked dispatch cannot trigger adapter execution', async () => {
  let invoked = false;
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'test.adapter',
    capability: 'test.cap',
    availability: AdapterAvailability.AVAILABLE,
    async invoke() {
      invoked = true;
      return { status: ExecutionResultStatus.SUCCEEDED, output: null, evidence: [] };
    }
  });

  // Draft status cannot execute
  const draftDispatch = {
    id: 'disp-draft',
    capability: 'test.cap',
    adapterId: 'test.adapter',
    input: {},
    status: 'DRAFT',
    blockReason: null
  };

  const draftResult = await executeOnce(draftDispatch, adapters);
  assert.equal(draftResult.status, ExecutionResultStatus.NOT_PERFORMED);
  assert.equal(invoked, false);

  // Blocked status cannot execute
  const blockedDispatch = {
    id: 'disp-blocked',
    capability: 'test.cap',
    adapterId: 'test.adapter',
    input: {},
    status: 'BLOCKED',
    blockReason: 'PREFLIGHT_AUTHORITY_INSUFFICIENT'
  };

  const blockedResult = await executeOnce(blockedDispatch, adapters);
  assert.equal(blockedResult.status, ExecutionResultStatus.NOT_PERFORMED);
  assert.equal(blockedResult.error?.code, 'PREFLIGHT_AUTHORITY_INSUFFICIENT');
  assert.equal(invoked, false);
});

test('P0 Adversarial: UNKNOWN and PARTIAL verification states strictly reject completion promotion', () => {
  const kernel = new ShortcutOSKernel();
  const run = kernel.createRun({
    goal: 'Audit critical invariants',
    acceptanceCriteria: ['invariant 1 must pass', 'invariant 2 must pass']
  });

  kernel.markPlanned(run.id);

  // Execution without evidence cannot promote
  assert.throws(
    () => {
      kernel.markExecuted(run.id, null);
    },
    (err) => Boolean(err)
  );

  // Verification with acceptancePassed = false leaves completed = false
  const execEvidence = createEvidenceEnvelope({
    kind: 'audit-run',
    ref: 'test-run-1',
    source: 'test',
    payload: { status: 'PARTIAL' }
  });
  kernel.markExecuted(run.id, execEvidence);

  const verifiedPartial = kernel.verify(run.id, [execEvidence], false);
  assert.equal(verifiedPartial.completed, false);
  assert.notEqual(verifiedPartial.verificationStatus, VerificationStatus.RUNTIME_VERIFIED);
});