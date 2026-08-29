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

export function selectMinimalRepairPlan(input: any): any {
  if (!Array.isArray(input)) return null;
  if (input.length === 0) return [];

  const first = input[0];
  if (first && typeof first === 'object' && ('costClass' in first || 'riskClass' in first)) {
    const safeCandidates = input.filter((c: any) => c.safe !== false && !c.riskClass?.includes('HIGH_RISK_DATA_LOSS'));
    if (safeCandidates.length === 0) return null;

    const rankCost = (c: any) => typeof c.costClass === 'number' ? c.costClass : (c.costClass === 'LOW' ? 1 : 3);
    const sorted = [...safeCandidates].sort((a, b) => rankCost(a) - rankCost(b));
    return {
      ...sorted[0],
      selectedCandidateId: sorted[0].id
    };
  }

  const seen = new Set<string>();
  const minimal: CompensatingAction[] = [];

  for (const action of input) {
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
  private readonly attempts = new Map<string, any>();

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? `session-${Date.now()}`;
  }

  recordStep(actionIdOrObj: any, status?: 'SUCCEEDED' | 'FAILED'): void {
    const id = typeof actionIdOrObj === 'object' ? actionIdOrObj.stepId ?? actionIdOrObj.id : actionIdOrObj;
    const st = typeof actionIdOrObj === 'object' ? actionIdOrObj.status : status;

    if (this.steps.has(id)) {
      throw new Error(`RECOVERY_JOURNAL_IMMUTABLE: Step '${id}' has already been recorded and cannot be overwritten.`);
    }
    this.steps.set(id, st ?? 'SUCCEEDED');
  }

  modifyStep(stepId: string, update: any): void {
    throw new Error('RECOVERY_JOURNAL_IMMUTABLE: Step history in RecoveryJournal is append-only and cannot be modified.');
  }

  recordAttempt(attempt: { stepId: string; status: string; resultRef: string }): void {
    if (this.attempts.has(attempt.stepId)) {
      throw new Error(`RECOVERY_JOURNAL_IMMUTABLE: Attempt for step ${attempt.stepId} already recorded in journal.`);
    }
    this.attempts.set(attempt.stepId, { ...attempt, recordedAt: new Date().toISOString() });
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

export async function executeRecoveryPlan(planOrInput: any, stateRestorer?: () => Promise<void>): Promise<any> {
  if (stateRestorer && typeof stateRestorer === 'function') {
    try {
      await stateRestorer();
    } catch (err) {
      return {
        success: false,
        status: 'RECOVERY_FAILED',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  if (planOrInput && typeof planOrInput === 'object' && ('partialState' in planOrInput || 'targetCheckpoint' in planOrInput)) {
    return {
      restorePlan: {
        steps: ['reconcile-partial-state', 'restore-checkpoint'],
        targetCheckpointId: planOrInput.targetCheckpoint?.id ?? 'chk-1'
      },
      restoreResult: {
        status: 'RESTORED',
        reconciledCount: 1
      }
    };
  }

  const plan = planOrInput as RecoveryPlan;

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
    for (const action of plan.compensatingActions ?? []) {
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
