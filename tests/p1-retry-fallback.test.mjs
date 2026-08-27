import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AuthorityLevel,
  ToolAdapterRegistry,
  AdapterAvailability,
  SideEffectClass,
  ExecutionResultStatus,
  createDispatch,
  executeWithRetryAndFallback,
  ContextFreshness
} from '../dist/index.js';

test('P1: Bounded retry succeeds after transient failure on idempotent operation', async () => {
  let callCount = 0;
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'flaky.api',
    capability: 'network.fetch',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      callCount++;
      if (callCount === 1) {
        throw new Error('NETWORK_TIMEOUT');
      }
      return {
        status: ExecutionResultStatus.SUCCEEDED,
        output: { data: 'hello' },
        evidence: [{ kind: 'fetch-result', ref: 'fetch-001' }]
      };
    }
  });

  const dispatch = createDispatch({
    id: 'disp-fetch',
    capability: 'network.fetch',
    adapterId: 'flaky.api',
    input: { url: 'https://example.com' }
  }, adapters);

  const result = await executeWithRetryAndFallback({
    dispatch,
    adapters,
    policy: {
      maxAttempts: 3,
      retryableErrorCodes: ['EXECUTION_TIMEOUT', 'EXECUTION_INVOCATION_FAILED']
    }
  });

  assert.equal(result.status, ExecutionResultStatus.SUCCEEDED);
  assert.equal(callCount, 2);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, ExecutionResultStatus.FAILED);
  assert.equal(result.attempts[1].status, ExecutionResultStatus.SUCCEEDED);
});

test('P1: Retry exhaustion after reaching maximum attempts', async () => {
  let callCount = 0;
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'broken.api',
    capability: 'network.fetch',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      callCount++;
      throw new Error('SERVICE_UNAVAILABLE');
    }
  });

  const dispatch = createDispatch({
    id: 'disp-broken',
    capability: 'network.fetch',
    adapterId: 'broken.api',
    input: {}
  }, adapters);

  const result = await executeWithRetryAndFallback({
    dispatch,
    adapters,
    policy: {
      maxAttempts: 3,
      retryableErrorCodes: ['EXECUTION_INVOCATION_FAILED']
    }
  });

  assert.equal(result.status, ExecutionResultStatus.FAILED);
  assert.equal(callCount, 3);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.error?.code, 'RETRY_EXHAUSTED');
});

test('P1: Non-retryable error (ambiguous side-effect) blocks retry immediately', async () => {
  let callCount = 0;
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'mutate.api',
    capability: 'db.update',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.NON_IDEMPOTENT_MUTATION,
    async invoke() {
      callCount++;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ status: ExecutionResultStatus.SUCCEEDED, output: 'ok', evidence: [] });
        }, 100);
      });
    }
  });

  const dispatch = createDispatch({
    id: 'disp-mutate',
    capability: 'db.update',
    adapterId: 'mutate.api',
    input: { rowId: 1 }
  }, adapters);

  const result = await executeWithRetryAndFallback({
    dispatch,
    adapters,
    timeoutMs: 20,
    idempotencyKey: 'idem-key-123',
    policy: {
      maxAttempts: 3
    }
  });

  assert.equal(result.status, ExecutionResultStatus.UNKNOWN);
  assert.equal(result.error?.code, 'EXECUTION_AMBIGUOUS_SIDE_EFFECT');
  // Mutation timed out -> ambiguous -> must NOT retry!
  assert.equal(callCount, 1);
  assert.equal(result.attempts.length, 1);
});

test('P1: Controlled fallback to secondary adapter on primary failure', async () => {
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'primary.llm',
    capability: 'llm.generate',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      throw new Error('PROVIDER_RATE_LIMIT');
    }
  });

  adapters.register({
    id: 'fallback.llm',
    capability: 'llm.generate',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      return {
        status: ExecutionResultStatus.SUCCEEDED,
        output: { text: 'fallback response' },
        evidence: [{ kind: 'llm-output', ref: 'fallback-001' }]
      };
    }
  });

  const dispatch = createDispatch({
    id: 'disp-llm',
    capability: 'llm.generate',
    adapterId: 'primary.llm',
    input: { prompt: 'hi' }
  }, adapters);

  const result = await executeWithRetryAndFallback({
    dispatch,
    adapters,
    policy: {
      maxAttempts: 2,
      fallbackAdapters: ['fallback.llm']
    }
  });

  assert.equal(result.status, ExecutionResultStatus.SUCCEEDED);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].adapterId, 'primary.llm');
  assert.equal(result.attempts[0].status, ExecutionResultStatus.FAILED);
  assert.equal(result.attempts[1].adapterId, 'fallback.llm');
  assert.equal(result.attempts[1].status, ExecutionResultStatus.SUCCEEDED);
  assert.equal(result.rebindings.length, 1);
  assert.equal(result.rebindings[0].fromAdapterId, 'primary.llm');
  assert.equal(result.rebindings[0].toAdapterId, 'fallback.llm');
});

test('P1: Fallback adapter with capability mismatch is rejected and not executed', async () => {
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'primary.llm',
    capability: 'llm.generate',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      throw new Error('PROVIDER_ERROR');
    }
  });

  adapters.register({
    id: 'wrong.fallback',
    capability: 'other.capability', // mismatch!
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      return { status: ExecutionResultStatus.SUCCEEDED, output: 'wrong', evidence: [] };
    }
  });

  const dispatch = createDispatch({
    id: 'disp-llm-2',
    capability: 'llm.generate',
    adapterId: 'primary.llm',
    input: {}
  }, adapters);

  const result = await executeWithRetryAndFallback({
    dispatch,
    adapters,
    policy: {
      maxAttempts: 2,
      fallbackAdapters: ['wrong.fallback']
    }
  });

  assert.equal(result.status, ExecutionResultStatus.FAILED);
  assert.equal(result.rebindings.length, 0); // No invalid rebinding performed
});