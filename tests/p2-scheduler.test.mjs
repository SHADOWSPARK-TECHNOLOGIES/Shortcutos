import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolAdapterRegistry,
  AdapterAvailability,
  SideEffectClass,
  ExecutionResultStatus
} from '../dist/index.js';
import { executeWorkflow } from '../dist/scheduler.js';

test('P2: Sequential execution executes steps in dependency order and collects outputs', async () => {
  const executionOrder = [];
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'step1.adapter',
    capability: 'step1',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke(input) {
      executionOrder.push('step1');
      return {
        status: ExecutionResultStatus.SUCCEEDED,
        output: { result1: 'hello' },
        evidence: []
      };
    }
  });

  adapters.register({
    id: 'step2.adapter',
    capability: 'step2',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke(input) {
      executionOrder.push('step2');
      return {
        status: ExecutionResultStatus.SUCCEEDED,
        output: { result2: `${input.prevResult}_world` },
        evidence: []
      };
    }
  });

  const workflow = {
    id: 'wf-seq-1',
    steps: [
      {
        id: 's1',
        capability: 'step1',
        adapterId: 'step1.adapter',
        input: {},
        dependsOn: []
      },
      {
        id: 's2',
        capability: 'step2',
        adapterId: 'step2.adapter',
        inputBuilder: (prevOutputs) => ({ prevResult: prevOutputs.s1.result1 }),
        dependsOn: ['s1']
      }
    ]
  };

  const result = await executeWorkflow(workflow, adapters);

  assert.equal(result.status, ExecutionResultStatus.SUCCEEDED);
  assert.deepEqual(executionOrder, ['step1', 'step2']);
  assert.equal(result.stepResults.s1.output.result1, 'hello');
  assert.equal(result.stepResults.s2.output.result2, 'hello_world');
});

test('P2: Step failure halts workflow execution and skips dependent steps', async () => {
  const executionOrder = [];
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'fail.adapter',
    capability: 'step.fail',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      executionOrder.push('fail');
      throw new Error('STEP_FAILED_ERR');
    }
  });

  adapters.register({
    id: 'skip.adapter',
    capability: 'step.skip',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      executionOrder.push('skip');
      return { status: ExecutionResultStatus.SUCCEEDED, output: 'ok', evidence: [] };
    }
  });

  const workflow = {
    id: 'wf-fail-1',
    steps: [
      {
        id: 's1',
        capability: 'step.fail',
        adapterId: 'fail.adapter',
        input: {},
        dependsOn: []
      },
      {
        id: 's2',
        capability: 'step.skip',
        adapterId: 'skip.adapter',
        input: {},
        dependsOn: ['s1']
      }
    ]
  };

  const result = await executeWorkflow(workflow, adapters);

  assert.equal(result.status, ExecutionResultStatus.FAILED);
  assert.deepEqual(executionOrder, ['fail']);
  assert.equal(result.stepResults.s1.status, ExecutionResultStatus.FAILED);
  assert.equal(result.stepResults.s2.status, ExecutionResultStatus.SKIPPED);
});

test('P2: Ambiguous side-effect in step halts workflow with UNKNOWN status', async () => {
  const executionOrder = [];
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'mutate.timeout',
    capability: 'db.mutate',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.NON_IDEMPOTENT_MUTATION,
    async invoke() {
      executionOrder.push('mutate');
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ status: ExecutionResultStatus.SUCCEEDED, output: 'done', evidence: [] });
        }, 100);
      });
    }
  });

  const workflow = {
    id: 'wf-unknown-1',
    steps: [
      {
        id: 's1',
        capability: 'db.mutate',
        adapterId: 'mutate.timeout',
        input: { data: 1 },
        idempotencyKey: 'idem-mutate-1',
        dependsOn: []
      }
    ]
  };

  const result = await executeWorkflow(workflow, adapters, { timeoutMs: 20 });

  assert.equal(result.status, ExecutionResultStatus.UNKNOWN);
  assert.equal(result.stepResults.s1.status, ExecutionResultStatus.UNKNOWN);
  assert.equal(result.error?.code, 'WORKFLOW_STEP_AMBIGUOUS');
});

test('P2: Cyclic dependency in workflow is rejected before execution', async () => {
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'dummy.adapter',
    capability: 'dummy',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      return { status: ExecutionResultStatus.SUCCEEDED, output: 'ok', evidence: [] };
    }
  });

  const workflow = {
    id: 'wf-cycle-1',
    steps: [
      { id: 's1', capability: 'dummy', adapterId: 'dummy.adapter', dependsOn: ['s2'] },
      { id: 's2', capability: 'dummy', adapterId: 'dummy.adapter', dependsOn: ['s1'] }
    ]
  };

  const result = await executeWorkflow(workflow, adapters);

  assert.equal(result.status, ExecutionResultStatus.NOT_PERFORMED);
  assert.equal(result.error?.code, 'WORKFLOW_CYCLIC_DEPENDENCY');
});
