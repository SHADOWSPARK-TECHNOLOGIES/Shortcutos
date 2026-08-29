import {
  AdapterAvailability,
  ExecutionResultStatus,
  SideEffectClass,
  type ToolAdapterRegistry,
  type ToolInvocationOptions
} from './adapter.js';
import { DispatchStatus, PREFLIGHT_AUTH_SYMBOL, type DispatchRequest } from './dispatch.js';
import type { RuntimeEvidence } from './status.js';

export type ExecutionError = {
  code: string;
  message: string;
};

export type ExecutionEnvelope = {
  dispatchId: string;
  status: ExecutionResultStatus;
  output: unknown;
  error: ExecutionError | null;
  evidence: RuntimeEvidence[];
};

export type ExecuteOptions = ToolInvocationOptions;

export async function executeOnce(
  dispatch: DispatchRequest,
  adapters: ToolAdapterRegistry,
  options?: ExecuteOptions
): Promise<ExecutionEnvelope> {
  if (dispatch.status !== DispatchStatus.READY_FOR_EXECUTION) {
    return {
      dispatchId: dispatch.id,
      status: ExecutionResultStatus.NOT_PERFORMED,
      output: null,
      error: {
        code: dispatch.blockReason ?? 'DISPATCH_NOT_READY',
        message: 'Dispatch is not ready for execution.'
      },
      evidence: []
    };
  }

  if (!dispatch.authorization || !dispatch.authorization[PREFLIGHT_AUTH_SYMBOL]) {
    return {
      dispatchId: dispatch.id,
      status: ExecutionResultStatus.NOT_PERFORMED,
      output: null,
      error: {
        code: 'PREFLIGHT_AUTHORIZATION_REQUIRED',
        message: 'Dispatch lacks valid non-forgeable PreflightAuthorization.'
      },
      evidence: []
    };
  }

  const adapter = adapters.get(dispatch.adapterId);
  if (!adapter || adapter.availability !== AdapterAvailability.AVAILABLE) {
    return {
      dispatchId: dispatch.id,
      status: ExecutionResultStatus.NOT_PERFORMED,
      output: null,
      error: {
        code: 'EXECUTION_ADAPTER_UNAVAILABLE',
        message: 'The selected adapter is unavailable at execution time.'
      },
      evidence: []
    };
  }

  if (adapter.capability !== dispatch.capability) {
    return {
      dispatchId: dispatch.id,
      status: ExecutionResultStatus.NOT_PERFORMED,
      output: null,
      error: {
        code: 'EXECUTION_CAPABILITY_MISMATCH',
        message: 'Adapter capability no longer matches the dispatch contract.'
      },
      evidence: []
    };
  }

  const isMutation =
    adapter.sideEffectClass === SideEffectClass.NON_IDEMPOTENT_MUTATION ||
    adapter.sideEffectClass === SideEffectClass.IRREVERSIBLE;

  try {
    let invocationPromise = adapter.invoke(dispatch.input, options);

    if (options?.timeoutMs && options.timeoutMs > 0) {
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutErr = new Error(`EXECUTION_TIMEOUT: Exceeded ${options.timeoutMs}ms`);
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        }, options.timeoutMs);
      });

      invocationPromise = Promise.race([
        invocationPromise.finally(() => clearTimeout(timeoutId)),
        timeoutPromise
      ]);
    }

    const result = await invocationPromise;
    return {
      dispatchId: dispatch.id,
      status: result.status,
      output: result.output,
      error: null,
      evidence: [...result.evidence]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout =
      (error instanceof Error && error.name === 'TimeoutError') ||
      message.includes('EXECUTION_TIMEOUT') ||
      message.includes('timeout');
    const isAbort =
      (error instanceof Error && error.name === 'AbortError') ||
      message.includes('ABORT') ||
      message.includes('abort');

    if (isTimeout && isMutation) {
      return {
        dispatchId: dispatch.id,
        status: ExecutionResultStatus.UNKNOWN,
        output: null,
        error: {
          code: 'EXECUTION_AMBIGUOUS_SIDE_EFFECT',
          message: `Timed out on mutating operation. Result is unknown: ${message}`
        },
        evidence: []
      };
    }

    const code = isTimeout
      ? 'EXECUTION_TIMEOUT'
      : isAbort
      ? 'EXECUTION_ABORTED'
      : 'EXECUTION_INVOCATION_FAILED';

    return {
      dispatchId: dispatch.id,
      status: ExecutionResultStatus.FAILED,
      output: null,
      error: {
        code,
        message
      },
      evidence: []
    };
  }
}