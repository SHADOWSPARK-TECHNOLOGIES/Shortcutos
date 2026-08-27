import {
  AdapterAvailability,
  ExecutionResultStatus,
  SideEffectClass,
  type ToolAdapterRegistry
} from './adapter.js';
import { AuthorityLevel } from './authority.js';
import { ContextFreshness } from './context.js';
import { createDispatch, preflightDispatch, type DispatchRequest } from './dispatch.js';
import { executeOnce } from './executor.js';
import type { RuntimeEvidence } from './status.js';

export type RetryPolicy = {
  maxAttempts?: number;
  retryableErrorCodes?: string[];
  fallbackAdapters?: string[];
};

export type ExecutionAttempt = {
  attemptNumber: number;
  adapterId: string;
  timestamp: string;
  status: ExecutionResultStatus;
  error: { code: string; message: string } | null;
  durationMs: number;
};

export type RebindingRecord = {
  fromAdapterId: string;
  toAdapterId: string;
  reason: string;
  timestamp: string;
};

export type RetryExecutionResult = {
  dispatchId: string;
  status: ExecutionResultStatus;
  output: unknown;
  error: { code: string; message: string } | null;
  evidence: RuntimeEvidence[];
  attempts: ExecutionAttempt[];
  rebindings: RebindingRecord[];
};

export type RetryExecutionOptions = {
  dispatch: DispatchRequest;
  adapters: ToolAdapterRegistry;
  policy?: RetryPolicy | undefined;
  timeoutMs?: number | undefined;
  abortSignal?: AbortSignal | undefined;
  actorAuthority?: AuthorityLevel | undefined;
  contextFreshness?: ContextFreshness | undefined;
  hasConflicts?: boolean | undefined;
  idempotencyKey?: string | null | undefined;
};

export async function executeWithRetryAndFallback(
  options: RetryExecutionOptions
): Promise<RetryExecutionResult> {
  const maxAttempts = Math.max(1, options.policy?.maxAttempts ?? 1);
  const attempts: ExecutionAttempt[] = [];
  const rebindings: RebindingRecord[] = [];
  const fallbackQueue = [...(options.policy?.fallbackAdapters ?? [])];

  let currentAdapterId = options.dispatch.adapterId;
  let lastEvidence: RuntimeEvidence[] = [];
  let lastOutput: unknown = null;
  let lastError: { code: string; message: string } | null = null;
  let lastStatus: ExecutionResultStatus = ExecutionResultStatus.FAILED;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const startTime = Date.now();
    const preflightOpts = {
      actorAuthority: options.actorAuthority ?? AuthorityLevel.USER,
      contextFreshness: options.contextFreshness ?? ContextFreshness.FRESH,
      hasConflicts: options.hasConflicts ?? false,
      idempotencyKey: options.idempotencyKey ?? options.dispatch.id
    };

    const currentDispatch = createDispatch(
      {
        id: options.dispatch.id,
        capability: options.dispatch.capability,
        adapterId: currentAdapterId,
        input: options.dispatch.input
      },
      options.adapters,
      preflightOpts
    );

    const preflight = preflightDispatch({
      dispatch: currentDispatch,
      adapters: options.adapters,
      ...preflightOpts
    });

    if (!preflight.eligible) {
      const err = {
        code: preflight.reasons[0] ?? 'PREFLIGHT_INELIGIBLE',
        message: `Preflight failed: ${preflight.reasons.join(', ')}`
      };
      attempts.push({
        attemptNumber,
        adapterId: currentAdapterId,
        timestamp: new Date().toISOString(),
        status: ExecutionResultStatus.NOT_PERFORMED,
        error: err,
        durationMs: Date.now() - startTime
      });
      lastError = err;
      lastStatus = ExecutionResultStatus.FAILED;
      break;
    }

    const envelope = await executeOnce(currentDispatch, options.adapters, {
      timeoutMs: options.timeoutMs,
      abortSignal: options.abortSignal
    });

    const durationMs = Date.now() - startTime;
    attempts.push({
      attemptNumber,
      adapterId: currentAdapterId,
      timestamp: new Date().toISOString(),
      status: envelope.status,
      error: envelope.error,
      durationMs
    });

    lastStatus = envelope.status;
    lastOutput = envelope.output;
    lastEvidence = envelope.evidence;
    lastError = envelope.error;

    if (envelope.status === ExecutionResultStatus.SUCCEEDED) {
      return {
        dispatchId: options.dispatch.id,
        status: ExecutionResultStatus.SUCCEEDED,
        output: envelope.output,
        error: null,
        evidence: envelope.evidence,
        attempts,
        rebindings
      };
    }

    // Ambiguous side-effect outcome -> strictly forbidden to retry or fallback
    if (
      envelope.status === ExecutionResultStatus.UNKNOWN ||
      envelope.error?.code === 'EXECUTION_AMBIGUOUS_SIDE_EFFECT'
    ) {
      return {
        dispatchId: options.dispatch.id,
        status: ExecutionResultStatus.UNKNOWN,
        output: null,
        error: envelope.error,
        evidence: envelope.evidence,
        attempts,
        rebindings
      };
    }

    // Check if fallback is available
    if (fallbackQueue.length > 0 && attemptNumber < maxAttempts) {
      const nextCandidate = fallbackQueue.shift()!;
      const candidateAdapter = options.adapters.get(nextCandidate);

      if (
        candidateAdapter &&
        candidateAdapter.availability === AdapterAvailability.AVAILABLE &&
        candidateAdapter.capability === options.dispatch.capability
      ) {
        rebindings.push({
          fromAdapterId: currentAdapterId,
          toAdapterId: nextCandidate,
          reason: envelope.error?.code ?? 'ADAPTER_FAILED',
          timestamp: new Date().toISOString()
        });
        currentAdapterId = nextCandidate;
        continue;
      }
    }

    // Check if error is retryable
    const retryableCodes = options.policy?.retryableErrorCodes;
    if (retryableCodes && envelope.error && !retryableCodes.includes(envelope.error.code)) {
      break;
    }
  }

  return {
    dispatchId: options.dispatch.id,
    status: lastStatus,
    output: lastOutput,
    error:
      attempts.length >= maxAttempts
        ? {
            code: 'RETRY_EXHAUSTED',
            message: `Execution failed after ${attempts.length} attempts: ${lastError?.message ?? 'Unknown'}`
          }
        : lastError,
    evidence: lastEvidence,
    attempts,
    rebindings
  };
}