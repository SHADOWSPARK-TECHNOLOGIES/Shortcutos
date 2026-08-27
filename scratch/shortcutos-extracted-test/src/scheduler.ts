import {
  AdapterAvailability,
  ExecutionResultStatus,
  SideEffectClass,
  type ToolAdapterRegistry
} from './adapter.js';
import { AuthorityLevel } from './authority.js';
import { createDispatch } from './dispatch.js';
import { executeWithRetryAndFallback, type RetryPolicy } from './retry.js';
import type { ExecutionError } from './executor.js';
import type { RuntimeEvidence } from './status.js';
import type { ContextFreshness } from './context.js';

export type WorkflowStep = {
  id: string;
  capability: string;
  adapterId: string;
  input?: Record<string, unknown> | undefined;
  inputBuilder?: ((prevOutputs: Record<string, Record<string, unknown>>) => Record<string, unknown>) | undefined;
  dependsOn?: string[] | undefined;
  idempotencyKey?: string | null | undefined;
  timeoutMs?: number | undefined;
  retryPolicy?: RetryPolicy | undefined;
};

export type WorkflowDefinition = {
  id: string;
  steps: WorkflowStep[];
};

export type WorkflowStepResult = {
  stepId: string;
  status: ExecutionResultStatus;
  output: unknown;
  error: ExecutionError | null;
  evidence: RuntimeEvidence[];
};

export type WorkflowExecutionOptions = {
  actorAuthority?: AuthorityLevel | undefined;
  contextFreshness?: ContextFreshness | undefined;
  hasConflicts?: boolean | undefined;
  timeoutMs?: number | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type WorkflowExecutionResult = {
  workflowId: string;
  status: ExecutionResultStatus;
  error: ExecutionError | null;
  stepResults: Record<string, WorkflowStepResult>;
};

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  adapters: ToolAdapterRegistry,
  options?: WorkflowExecutionOptions
): Promise<WorkflowExecutionResult> {
  const stepResults: Record<string, WorkflowStepResult> = {};
  const outputs: Record<string, Record<string, unknown>> = {};

  // Build dependency graph and in-degrees
  const stepMap = new Map<string, WorkflowStep>();
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  for (const step of workflow.steps) {
    stepMap.set(step.id, step);
    inDegree.set(step.id, 0);
    graph.set(step.id, []);
  }

  for (const step of workflow.steps) {
    const deps = step.dependsOn ?? [];
    for (const depId of deps) {
      if (!stepMap.has(depId)) {
        return {
          workflowId: workflow.id,
          status: ExecutionResultStatus.NOT_PERFORMED,
          error: {
            code: 'WORKFLOW_INVALID_DEPENDENCY',
            message: `Step ${step.id} depends on non-existent step ${depId}`
          },
          stepResults: {}
        };
      }
      graph.get(depId)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  // Topological sort via Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const sortedSteps: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sortedSteps.push(current);
    for (const neighbor of graph.get(current) ?? []) {
      const nextDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, nextDeg);
      if (nextDeg === 0) queue.push(neighbor);
    }
  }

  if (sortedSteps.length !== workflow.steps.length) {
    return {
      workflowId: workflow.id,
      status: ExecutionResultStatus.NOT_PERFORMED,
      error: {
        code: 'WORKFLOW_CYCLIC_DEPENDENCY',
        message: 'Cyclic dependency detected in workflow steps'
      },
      stepResults: {}
    };
  }

  let overallStatus: ExecutionResultStatus = ExecutionResultStatus.SUCCEEDED;
  let overallError: ExecutionError | null = null;

  for (const stepId of sortedSteps) {
    const step = stepMap.get(stepId)!;
    const deps = step.dependsOn ?? [];

    // Check if any dependency failed, was skipped, or was ambiguous
    const unfulfilledDep = deps.find(
      (depId) => stepResults[depId]?.status !== ExecutionResultStatus.SUCCEEDED
    );

    if (unfulfilledDep || overallStatus !== ExecutionResultStatus.SUCCEEDED) {
      stepResults[stepId] = {
        stepId,
        status: ExecutionResultStatus.SKIPPED,
        output: null,
        error: {
          code: 'WORKFLOW_DEPENDENCY_UNFULFILLED',
          message: `Skipped because dependency ${unfulfilledDep ?? 'prior step'} was not SUCCEEDED`
        },
        evidence: []
      };
      continue;
    }

    // Prepare input
    let stepInput: Record<string, unknown> = step.input ?? {};
    if (step.inputBuilder) {
      try {
        stepInput = step.inputBuilder(outputs);
      } catch (err) {
        stepResults[stepId] = {
          stepId,
          status: ExecutionResultStatus.FAILED,
          output: null,
          error: {
            code: 'WORKFLOW_INPUT_BUILDER_ERROR',
            message: err instanceof Error ? err.message : String(err)
          },
          evidence: []
        };
        overallStatus = ExecutionResultStatus.FAILED;
        overallError = stepResults[stepId].error;
        continue;
      }
    }

    const dispatch = createDispatch(
      {
        id: `disp-${stepId}`,
        capability: step.capability,
        adapterId: step.adapterId,
        input: stepInput
      },
      adapters,
      {
        actorAuthority: AuthorityLevel.USER,
        idempotencyKey: step.idempotencyKey ?? `idem-${stepId}`
      }
    );

    const stepTimeout = step.timeoutMs ?? options?.timeoutMs;

    const res = await executeWithRetryAndFallback({
      dispatch,
      adapters,
      actorAuthority: options?.actorAuthority,
      contextFreshness: options?.contextFreshness,
      hasConflicts: options?.hasConflicts,
      idempotencyKey: step.idempotencyKey,
      timeoutMs: stepTimeout,
      abortSignal: options?.abortSignal,
      policy: step.retryPolicy
    });

    stepResults[stepId] = {
      stepId,
      status: res.status,
      output: res.output,
      error: res.error,
      evidence: res.evidence
    };

    if (res.status === ExecutionResultStatus.SUCCEEDED) {
      if (typeof res.output === 'object' && res.output !== null) {
        outputs[stepId] = res.output as Record<string, unknown>;
      } else {
        outputs[stepId] = { value: res.output };
      }
    } else if (res.status === ExecutionResultStatus.UNKNOWN) {
      overallStatus = ExecutionResultStatus.UNKNOWN;
      overallError = {
        code: 'WORKFLOW_STEP_AMBIGUOUS',
        message: `Workflow halted: step ${stepId} ended in UNKNOWN status.`
      };
    } else {
      overallStatus = ExecutionResultStatus.FAILED;
      overallError = res.error ?? {
        code: 'WORKFLOW_STEP_FAILED',
        message: `Workflow halted: step ${stepId} failed.`
      };
    }
  }

  return {
    workflowId: workflow.id,
    status: overallStatus,
    error: overallError,
    stepResults
  };
}
