import {
  AdapterAvailability,
  ExecutionResultStatus,
  type ToolAdapterRegistry
} from './adapter.js';
import { DispatchStatus, type DispatchRequest } from './dispatch.js';
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

export async function executeOnce(
  dispatch: DispatchRequest,
  adapters: ToolAdapterRegistry
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

  try {
    const result = await adapter.invoke(dispatch.input);
    return {
      dispatchId: dispatch.id,
      status: result.status,
      output: result.output,
      error: null,
      evidence: [...result.evidence]
    };
  } catch (error) {
    return {
      dispatchId: dispatch.id,
      status: ExecutionResultStatus.FAILED,
      output: null,
      error: {
        code: 'EXECUTION_INVOCATION_FAILED',
        message: error instanceof Error ? error.message : String(error)
      },
      evidence: []
    };
  }
}
