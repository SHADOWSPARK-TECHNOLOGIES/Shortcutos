import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolAdapterRegistry,
  AdapterAvailability,
  SideEffectClass,
  ExecutionResultStatus
} from '../dist/index.js';
import { DeterministicResourceScheduler } from '../dist/resource-scheduler.js';

test('P5: Resource capacity bounds concurrent execution and holds over-capacity tasks', async () => {
  const scheduler = new DeterministicResourceScheduler({
    capacity: { cpuUnits: 2, memoryMb: 1024 }
  });

  const executionLog = [];
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'heavy.proc',
    capability: 'proc',
    availability: AdapterAvailability.AVAILABLE,
    sideEffectClass: SideEffectClass.READ_ONLY,
    async invoke(input) {
      executionLog.push(input.id);
      await new Promise((r) => setTimeout(r, 50));
      return { status: ExecutionResultStatus.SUCCEEDED, output: 'done', evidence: [] };
    }
  });

  // Task 1 requires 2 CPU units (uses full capacity)
  // Task 2 requires 2 CPU units (must wait for Task 1 to finish)
  scheduler.addTask({
    id: 't1',
    capability: 'proc',
    adapterId: 'heavy.proc',
    input: { id: 't1' },
    resources: { cpuUnits: 2, memoryMb: 512 }
  });

  scheduler.addTask({
    id: 't2',
    capability: 'proc',
    adapterId: 'heavy.proc',
    input: { id: 't2' },
    resources: { cpuUnits: 2, memoryMb: 512 }
  });

  const result = await scheduler.run(adapters);

  assert.equal(result.status, ExecutionResultStatus.SUCCEEDED);
  assert.deepEqual(executionLog, ['t1', 't2']);
  assert.equal(result.taskResults.t1.status, ExecutionResultStatus.SUCCEEDED);
  assert.equal(result.taskResults.t2.status, ExecutionResultStatus.SUCCEEDED);
});

test('P5: Starvation prevention boosts priority of older runnable tasks', () => {
  const scheduler = new DeterministicResourceScheduler({
    capacity: { cpuUnits: 4, memoryMb: 2048 }
  });

  scheduler.addTask({
    id: 'old-low-priority',
    capability: 'p',
    adapterId: 'a',
    resources: { cpuUnits: 1, memoryMb: 128 },
    basePriority: 1,
    queuedAt: Date.now() - 5000 // queued 5 sec ago
  });

  scheduler.addTask({
    id: 'new-high-priority',
    capability: 'p',
    adapterId: 'a',
    resources: { cpuUnits: 1, memoryMb: 128 },
    basePriority: 10,
    queuedAt: Date.now()
  });

  const plan = scheduler.createReservationPlan(Date.now());
  // With starvation boost enabled, the older task receives priority promotion
  assert.equal(plan.runOrder[0], 'old-low-priority');
});
