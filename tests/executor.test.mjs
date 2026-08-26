import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdapterAvailability,
  ToolAdapterRegistry,
  createDispatch,
  DispatchStatus,
  executeOnce,
  ExecutionResultStatus
} from '../dist/index.js';

test('unavailable adapter is never invoked', async () => {
  let calls = 0;
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'tool.unavailable',
    capability: 'demo.echo',
    availability: AdapterAvailability.UNAVAILABLE,
    async invoke(input) {
      calls += 1;
      return { status: ExecutionResultStatus.SUCCEEDED, output: input, evidence: [] };
    }
  });

  const dispatch = createDispatch({
    id: 'dispatch-1',
    capability: 'demo.echo',
    adapterId: 'tool.unavailable',
    input: { value: 1 }
  }, adapters);

  assert.equal(dispatch.status, DispatchStatus.BLOCKED);
  const result = await executeOnce(dispatch, adapters);
  assert.equal(result.status, ExecutionResultStatus.NOT_PERFORMED);
  assert.equal(calls, 0);
});

test('available adapter executes exactly once and returns typed envelope', async () => {
  let calls = 0;
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'tool.echo',
    capability: 'demo.echo',
    availability: AdapterAvailability.AVAILABLE,
    async invoke(input) {
      calls += 1;
      return {
        status: ExecutionResultStatus.SUCCEEDED,
        output: { echoed: input },
        evidence: [{ kind: 'local-adapter', ref: 'echo-1' }]
      };
    }
  });

  const dispatch = createDispatch({
    id: 'dispatch-2',
    capability: 'demo.echo',
    adapterId: 'tool.echo',
    input: { value: 2 }
  }, adapters);

  assert.equal(dispatch.status, DispatchStatus.READY_FOR_EXECUTION);
  const result = await executeOnce(dispatch, adapters);
  assert.equal(result.status, ExecutionResultStatus.SUCCEEDED);
  assert.equal(calls, 1);
  assert.deepEqual(result.output, { echoed: { value: 2 } });
  assert.equal(result.evidence.length, 1);
});

test('adapter failure is recorded and not retried', async () => {
  let calls = 0;
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'tool.fail',
    capability: 'demo.echo',
    availability: AdapterAvailability.AVAILABLE,
    async invoke() {
      calls += 1;
      throw new Error('boom');
    }
  });

  const dispatch = createDispatch({
    id: 'dispatch-3',
    capability: 'demo.echo',
    adapterId: 'tool.fail',
    input: null
  }, adapters);

  const result = await executeOnce(dispatch, adapters);
  assert.equal(result.status, ExecutionResultStatus.FAILED);
  assert.equal(calls, 1);
  assert.match(result.error?.message ?? '', /boom/);
});

test('adapter capability mismatch blocks dispatch', () => {
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'tool.read',
    capability: 'file.read',
    availability: AdapterAvailability.AVAILABLE,
    async invoke(input) {
      return { status: ExecutionResultStatus.SUCCEEDED, output: input, evidence: [] };
    }
  });

  const dispatch = createDispatch({
    id: 'dispatch-4',
    capability: 'file.write',
    adapterId: 'tool.read',
    input: 'x'
  }, adapters);
  assert.equal(dispatch.status, DispatchStatus.BLOCKED);
  assert.equal(dispatch.blockReason, 'DISPATCH_CAPABILITY_MISMATCH');
});
