import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolAdapterRegistry,
  AdapterAvailability,
  SideEffectClass,
  ExecutionResultStatus
} from '../dist/index.js';
import { executeParallelGroup, analyzeConcurrencyConflicts } from '../dist/parallel.js';

test('P4: Concurrency limit (maxConcurrency) bounds active parallel executions', async () => {
  let activeCount = 0;
  let maxObservedActive = 0;

  const adapters = new ToolAdapterRegistry();
  for (let i = 1; i <= 5; i++) {
    adapters.register({
      id: `task.${i}`,
      capability: 'task.exec',
      availability: AdapterAvailability.AVAILABLE,
      sideEffectClass: SideEffectClass.READ_ONLY,
      async invoke() {
        activeCount++;
        maxObservedActive = Math.max(maxObservedActive, activeCount);
        await new Promise((r) => setTimeout(r, 50));
        activeCount--;
        return { status: ExecutionResultStatus.SUCCEEDED, output: `task-${i}-done`, evidence: [] };
      }
    });
  }

  const steps = [1, 2, 3, 4, 5].map((i) => ({
    id: `s${i}`,
    capability: 'task.exec',
    adapterId: `task.${i}`,
    input: {}
  }));

  const result = await executeParallelGroup(
    { id: 'group-1', steps, maxConcurrency: 2 },
    adapters
  );

  assert.equal(result.status, ExecutionResultStatus.SUCCEEDED);
  assert.equal(maxObservedActive <= 2, true);
  assert.equal(Object.keys(result.stepResults).length, 5);
});

test('P4: Shared-resource conflict detection prevents concurrent write-lock conflicts', async () => {
  const steps = [
    { id: 's1', capability: 'db.write', adapterId: 'a1', input: {}, writeResources: ['table:users'] },
    { id: 's2', capability: 'db.write', adapterId: 'a2', input: {}, writeResources: ['table:users'] }
  ];

  const analysis = analyzeConcurrencyConflicts(steps);
  assert.equal(analysis.hasConflicts, true);
  assert.equal(analysis.conflictingResources.includes('table:users'), true);
});

test('P4: Join policy FIRST_SUCCESS returns immediately when one step succeeds', async () => {
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'fast.adapter',
    capability: 'search',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      return { status: ExecutionResultStatus.SUCCEEDED, output: 'fast-win', evidence: [] };
    }
  });

  adapters.register({
    id: 'slow.adapter',
    capability: 'search',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke() {
      await new Promise((r) => setTimeout(r, 200));
      return { status: ExecutionResultStatus.SUCCEEDED, output: 'slow-win', evidence: [] };
    }
  });

  const steps = [
    { id: 's1', capability: 'search', adapterId: 'slow.adapter', input: {} },
    { id: 's2', capability: 'search', adapterId: 'fast.adapter', input: {} }
  ];

  const result = await executeParallelGroup(
    { id: 'group-fast', steps, joinPolicy: 'FIRST_SUCCESS' },
    adapters
  );

  assert.equal(result.status, ExecutionResultStatus.SUCCEEDED);
  assert.equal(result.winningStepId, 's2');
  assert.equal(result.stepResults.s2.output, 'fast-win');
});
