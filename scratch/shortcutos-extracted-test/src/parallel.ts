import {
  ExecutionResultStatus,
  ToolAdapterRegistry
} from './adapter.js';
import { createDispatch } from './dispatch.js';
import { executeWithRetryAndFallback } from './retry.js';
import type { ExecutionError } from './executor.js';
import type { RuntimeEvidence } from './status.js';
import type { AuthorityLevel } from './authority.js';
import type { ContextFreshness } from './context.js';

export type ParallelStep = {
  id: string;
  capability: string;
  adapterId: string;
  input?: Record<string, unknown> | undefined;
  readResources?: string[] | undefined;
  writeResources?: string[] | undefined;
  idempotencyKey?: string | null | undefined;
  timeoutMs?: number | undefined;
};

export type JoinPolicy = 'ALL' | 'FIRST_SUCCESS' | 'ANY_SETTLED';

export type ParallelStepGroup = {
  id: string;
  steps: ParallelStep[];
  maxConcurrency?: number | undefined;
  joinPolicy?: JoinPolicy | undefined;
};

export type ParallelStepResult = {
  stepId: string;
  status: ExecutionResultStatus;
  output: unknown;
  error: ExecutionError | null;
  evidence: RuntimeEvidence[];
};

export type ParallelGroupResult = {
  groupId: string;
  status: ExecutionResultStatus;
  winningStepId?: string | undefined;
  error: ExecutionError | null;
  stepResults: Record<string, ParallelStepResult>;
};

export type ConcurrencyAnalysis = {
  hasConflicts: boolean;
  conflictingResources: string[];
};

export function analyzeConcurrencyConflicts(steps: ParallelStep[]): ConcurrencyAnalysis {
  const readSet = new Set<string>();
  const writeSet = new Set<string>();
  const conflictingResources = new Set<string>();

  for (const step of steps) {
    const reads = step.readResources ?? [];
    const writes = step.writeResources ?? [];

    for (const w of writes) {
      if (writeSet.has(w) || readSet.has(w)) {
        conflictingResources.add(w);
      }
      writeSet.add(w);
    }

    for (const r of reads) {
      if (writeSet.has(r)) {
        conflictingResources.add(r);
      }
      readSet.add(r);
    }
  }

  return {
    hasConflicts: conflictingResources.size > 0,
    conflictingResources: Array.from(conflictingResources)
  };
}

export async function executeParallelGroup(
  group: ParallelStepGroup,
  adapters: ToolAdapterRegistry,
  options?: {
    actorAuthority?: AuthorityLevel | undefined;
    contextFreshness?: ContextFreshness | undefined;
    hasConflicts?: boolean | undefined;
    timeoutMs?: number | undefined;
    abortSignal?: AbortSignal | undefined;
  }
): Promise<ParallelGroupResult> {
  const maxConcurrency = Math.max(1, group.maxConcurrency ?? 4);
  const joinPolicy = group.joinPolicy ?? 'ALL';
  const stepResults: Record<string, ParallelStepResult> = {};

  let winningStepId: string | undefined = undefined;
  let groupStatus: ExecutionResultStatus = ExecutionResultStatus.SUCCEEDED;
  let groupError: ExecutionError | null = null;
  let isDone = false;

  // Active execution worker pool
  const pendingSteps = [...group.steps];
  const activePromises: Promise<void>[] = [];

  return new Promise<ParallelGroupResult>((resolve) => {
    const checkCompletion = () => {
      if (isDone) return;

      if (joinPolicy === 'FIRST_SUCCESS' && winningStepId) {
        isDone = true;
        resolve({
          groupId: group.id,
          status: ExecutionResultStatus.SUCCEEDED,
          winningStepId,
          error: null,
          stepResults
        });
        return;
      }

      if (pendingSteps.length === 0 && activePromises.length === 0) {
        isDone = true;
        resolve({
          groupId: group.id,
          status: groupStatus,
          winningStepId,
          error: groupError,
          stepResults
        });
      }
    };

    const spawnWorker = () => {
      if (isDone) return;
      while (activePromises.length < maxConcurrency && pendingSteps.length > 0) {
        const step = pendingSteps.shift()!;
        const taskPromise = (async () => {
          const dispatch = createDispatch(
            {
              id: `disp-par-${step.id}`,
              capability: step.capability,
              adapterId: step.adapterId,
              input: step.input ?? {}
            },
            adapters
          );

          const res = await executeWithRetryAndFallback({
            dispatch,
            adapters,
            actorAuthority: options?.actorAuthority,
            contextFreshness: options?.contextFreshness,
            hasConflicts: options?.hasConflicts,
            idempotencyKey: step.idempotencyKey,
            timeoutMs: step.timeoutMs ?? options?.timeoutMs,
            abortSignal: options?.abortSignal
          });

          stepResults[step.id] = {
            stepId: step.id,
            status: res.status,
            output: res.output,
            error: res.error,
            evidence: res.evidence
          };

          if (res.status === ExecutionResultStatus.SUCCEEDED && !winningStepId) {
            winningStepId = step.id;
          } else if (res.status === ExecutionResultStatus.UNKNOWN && groupStatus !== ExecutionResultStatus.FAILED) {
            groupStatus = ExecutionResultStatus.UNKNOWN;
            groupError = {
              code: 'PARALLEL_STEP_AMBIGUOUS',
              message: `Parallel step ${step.id} resulted in UNKNOWN status.`
            };
          } else if (res.status === ExecutionResultStatus.FAILED) {
            if (groupStatus !== ExecutionResultStatus.UNKNOWN) {
              groupStatus = ExecutionResultStatus.FAILED;
            }
            groupError = res.error;
          }
        })()
          .finally(() => {
            const idx = activePromises.indexOf(taskPromise);
            if (idx !== -1) activePromises.splice(idx, 1);
            checkCompletion();
            if (!isDone) spawnWorker();
          });

        activePromises.push(taskPromise);
      }
      checkCompletion();
    };

    spawnWorker();
  });
}
