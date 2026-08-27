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
  run: () => Promise<void>;
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

export type RecoveryExecutionResult = {
  status: 'RECOVERED_COMPENSATED' | 'RECOVERED_DEGRADED' | 'BLOCKED_HUMAN_INTERVENTION' | 'RECOVERY_FAILED';
  executedActions: string[];
  error: string | null;
};

export async function executeRecoveryPlan(plan: RecoveryPlan): Promise<RecoveryExecutionResult> {
  if (plan.requiresHumanIntervention) {
    return {
      status: 'BLOCKED_HUMAN_INTERVENTION',
      executedActions: [],
      error: 'Human intervention required due to ambiguous side-effect mutation failure.'
    };
  }

  const executedActions: string[] = [];
  try {
    for (const action of plan.compensatingActions) {
      await action.run();
      executedActions.push(action.id);
    }

    if (executedActions.length > 0) {
      return {
        status: 'RECOVERED_COMPENSATED',
        executedActions,
        error: null
      };
    }

    if (plan.degradedModeAvailable) {
      return {
        status: 'RECOVERED_DEGRADED',
        executedActions: [],
        error: null
      };
    }

    return {
      status: 'RECOVERY_FAILED',
      executedActions: [],
      error: 'No recovery strategy succeeded.'
    };
  } catch (err) {
    return {
      status: 'RECOVERY_FAILED',
      executedActions,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
