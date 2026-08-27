export enum FailureCategory {
  ADAPTER_TIMEOUT = 'ADAPTER_TIMEOUT',
  CAPABILITY_MISMATCH = 'CAPABILITY_MISMATCH',
  CONTEXT_STALE = 'CONTEXT_STALE',
  AMBIGUOUS_MUTATION = 'AMBIGUOUS_MUTATION',
  RESOURCE_EXHAUSTION = 'RESOURCE_EXHAUSTION',
  INTERNAL_FAULT = 'INTERNAL_FAULT'
}

export type CompensatingAction = {
  id: string;
  description: string;
  compensationKind?: string | undefined;
  run?: (() => Promise<void>) | undefined;
};

export type CompileRecoveryInput = {
  failureCode: string;
  isMutation?: boolean | undefined;
  compensatingActions?: CompensatingAction[] | undefined;
  degradedModeAvailable?: boolean | undefined;
};

export type RecoveryPlan = {
  category: FailureCategory;
  requiresHumanIntervention: boolean;
  compensatingActions: CompensatingAction[];
  degradedModeAvailable: boolean;
};

export function compileRecoveryPlan(input: CompileRecoveryInput): RecoveryPlan {
  let category = FailureCategory.INTERNAL_FAULT;
  let requiresHumanIntervention = false;

  const code = input.failureCode;
  if (code.includes('TIMEOUT') || code.includes('timeout')) {
    if (input.isMutation) {
      category = FailureCategory.AMBIGUOUS_MUTATION;
      requiresHumanIntervention = true;
    } else {
      category = FailureCategory.ADAPTER_TIMEOUT;
    }
  } else if (code.includes('CAPABILITY')) {
    category = FailureCategory.CAPABILITY_MISMATCH;
  } else if (code.includes('STALE')) {
    category = FailureCategory.CONTEXT_STALE;
  } else if (code.includes('RESOURCE') || code.includes('EXHAUSTED')) {
    category = FailureCategory.RESOURCE_EXHAUSTION;
  }

  const actions = input.compensatingActions ?? [];
  const degradedModeAvailable = input.degradedModeAvailable ?? true;

  return {
    category,
    requiresHumanIntervention,
    compensatingActions: actions,
    degradedModeAvailable
  };
}

export type RestoredStateRecord = {
  actionId: string;
  restoredAt: string;
  stateSnapshot: Record<string, unknown>;
};

export type RecoveryExecutionResult = {
  status: 'RECOVERED_COMPENSATED' | 'RECOVERED_DEGRADED' | 'BLOCKED_HUMAN_INTERVENTION' | 'RECOVERY_FAILED';
  executedActions: string[];
  restoredStates: RestoredStateRecord[];
  error: string | null;
};

export function selectMinimalRepairPlan(actions: CompensatingAction[]): CompensatingAction[] {
  const seen = new Set<string>();
  const minimal: CompensatingAction[] = [];

  for (const action of actions) {
    const key = action.compensationKind ?? action.description;
    if (!seen.has(key)) {
      seen.add(key);
      minimal.push(action);
    }
  }

  return minimal;
}

export class RecoveryJournal {
  public readonly sessionId: string;
  private readonly steps = new Map<string, 'SUCCEEDED' | 'FAILED'>();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  recordStep(actionId: string, status: 'SUCCEEDED' | 'FAILED'): void {
    this.steps.set(actionId, status);
  }

  isStepCompleted(actionId: string): boolean {
    return this.steps.get(actionId) === 'SUCCEEDED';
  }

  getCompletedStepIds(): string[] {
    const completed: string[] = [];
    for (const [id, st] of this.steps.entries()) {
      if (st === 'SUCCEEDED') completed.push(id);
    }
    return completed;
  }
}

export async function executeRecoveryPlan(plan: RecoveryPlan): Promise<RecoveryExecutionResult> {
  if (plan.requiresHumanIntervention) {
    return {
      status: 'BLOCKED_HUMAN_INTERVENTION',
      executedActions: [],
      restoredStates: [],
      error: 'Human intervention required due to ambiguous side-effect mutation failure.'
    };
  }

  const executedActions: string[] = [];
  const restoredStates: RestoredStateRecord[] = [];

  try {
    for (const action of plan.compensatingActions) {
      if (typeof action.run === 'function') {
        await action.run();
      }
      executedActions.push(action.id);
      restoredStates.push({
        actionId: action.id,
        restoredAt: new Date().toISOString(),
        stateSnapshot: { actionId: action.id, kind: action.compensationKind ?? 'DEFAULT_RESTORE' }
      });
    }

    if (executedActions.length > 0) {
      return {
        status: 'RECOVERED_COMPENSATED',
        executedActions,
        restoredStates,
        error: null
      };
    }

    if (plan.degradedModeAvailable) {
      return {
        status: 'RECOVERED_DEGRADED',
        executedActions: [],
        restoredStates: [],
        error: null
      };
    }

    return {
      status: 'RECOVERY_FAILED',
      executedActions: [],
      restoredStates: [],
      error: 'No recovery strategy succeeded.'
    };
  } catch (err) {
    return {
      status: 'RECOVERY_FAILED',
      executedActions,
      restoredStates,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
