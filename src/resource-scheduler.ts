import {
  ExecutionResultStatus,
  ToolAdapterRegistry
} from './adapter.js';
import { createDispatch } from './dispatch.js';
import { executeWithRetryAndFallback } from './retry.js';
import type { ExecutionError } from './executor.js';
import type { RuntimeEvidence } from './status.js';

export type ResourceCapacity = {
  cpuUnits: number;
  memoryMb: number;
};

export type ResourceRequirement = {
  cpuUnits: number;
  memoryMb: number;
};

export type ResourceTask = {
  id: string;
  capability: string;
  adapterId: string;
  input?: Record<string, unknown> | undefined;
  resources: ResourceRequirement;
  basePriority?: number | undefined;
  queuedAt?: number | undefined;
  idempotencyKey?: string | null | undefined;
  timeoutMs?: number | undefined;
};

export type ResourceTaskResult = {
  taskId: string;
  status: ExecutionResultStatus;
  output: unknown;
  error: ExecutionError | null;
  evidence: RuntimeEvidence[];
};

export type ResourceSchedulerResult = {
  status: ExecutionResultStatus;
  error: ExecutionError | null;
  taskResults: Record<string, ResourceTaskResult>;
};

export type ResourceReservationPlan = {
  runOrder: string[];
  reservedCapacity: Record<string, ResourceRequirement>;
};

export class DeterministicResourceScheduler {
  private readonly capacity: ResourceCapacity;
  private readonly tasks = new Map<string, ResourceTask>();

  constructor(config: { capacity: ResourceCapacity }) {
    this.capacity = { ...config.capacity };
  }

  addTask(task: ResourceTask): void {
    const queuedAt = task.queuedAt ?? Date.now();
    const basePriority = task.basePriority ?? 1;
    this.tasks.set(task.id, { ...task, queuedAt, basePriority });
  }

  calculateEffectivePriority(task: ResourceTask, now: number): number {
    const ageMs = Math.max(0, now - (task.queuedAt ?? now));
    const starvationBoost = Math.floor(ageMs / 1000) * 2; // +2 priority per second queued
    return (task.basePriority ?? 1) + starvationBoost;
  }

  createReservationPlan(now: number = Date.now()): ResourceReservationPlan {
    const sortedTasks = Array.from(this.tasks.values()).sort((a, b) => {
      const prioA = this.calculateEffectivePriority(a, now);
      const prioB = this.calculateEffectivePriority(b, now);
      if (prioB !== prioA) return prioB - prioA;
      return a.id.localeCompare(b.id);
    });

    const runOrder: string[] = [];
    const reservedCapacity: Record<string, ResourceRequirement> = {};

    for (const task of sortedTasks) {
      runOrder.push(task.id);
      reservedCapacity[task.id] = { ...task.resources };
    }

    return { runOrder, reservedCapacity };
  }

  async run(adapters: ToolAdapterRegistry): Promise<ResourceSchedulerResult> {
    const plan = this.createReservationPlan();
    const taskResults: Record<string, ResourceTaskResult> = {};

    let currentCpuUsed = 0;
    let currentMemoryUsed = 0;

    const remainingTasks = plan.runOrder
      .map((id) => this.tasks.get(id))
      .filter((t): t is ResourceTask => t !== undefined);
    const activeTasks = new Map<string, Promise<void>>();

    let overallStatus: ExecutionResultStatus = ExecutionResultStatus.SUCCEEDED;
    let overallError: ExecutionError | null = null;

    return new Promise<ResourceSchedulerResult>((resolve) => {
      const tryDispatchNext = () => {
        if (remainingTasks.length === 0 && activeTasks.size === 0) {
          resolve({
            status: overallStatus,
            error: overallError,
            taskResults
          });
          return;
        }

        for (let i = 0; i < remainingTasks.length; i++) {
          const task = remainingTasks[i];
          if (!task) continue;
          const canFit =
            currentCpuUsed + task.resources.cpuUnits <= this.capacity.cpuUnits &&
            currentMemoryUsed + task.resources.memoryMb <= this.capacity.memoryMb;

          if (canFit) {
            remainingTasks.splice(i, 1);
            currentCpuUsed += task.resources.cpuUnits;
            currentMemoryUsed += task.resources.memoryMb;

            const execPromise = (async () => {
              const dispatch = createDispatch(
                {
                  id: `disp-res-${task.id}`,
                  capability: task.capability,
                  adapterId: task.adapterId,
                  input: task.input ?? {}
                },
                adapters
              );

              const res = await executeWithRetryAndFallback({
                dispatch,
                adapters,
                idempotencyKey: task.idempotencyKey,
                timeoutMs: task.timeoutMs
              });

              taskResults[task.id] = {
                taskId: task.id,
                status: res.status,
                output: res.output,
                error: res.error,
                evidence: res.evidence
              };

              if (res.status === ExecutionResultStatus.UNKNOWN) {
                overallStatus = ExecutionResultStatus.UNKNOWN;
                overallError = { code: 'RESOURCE_TASK_AMBIGUOUS', message: `Task ${task.id} resulted in UNKNOWN` };
              } else if (res.status === ExecutionResultStatus.FAILED) {
                if (overallStatus !== ExecutionResultStatus.UNKNOWN) {
                  overallStatus = ExecutionResultStatus.FAILED;
                }
                overallError = res.error;
              }
            })().finally(() => {
              currentCpuUsed -= task.resources.cpuUnits;
              currentMemoryUsed -= task.resources.memoryMb;
              activeTasks.delete(task.id);
              tryDispatchNext();
            });

            activeTasks.set(task.id, execPromise);
            i--; // Adjust loop index after splice
          }
        }
      };

      tryDispatchNext();
    });
  }
}
