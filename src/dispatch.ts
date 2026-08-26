import { AdapterAvailability, type ToolAdapterRegistry } from './adapter.js';

export enum DispatchStatus {
  DRAFT = 'DRAFT',
  READY_FOR_EXECUTION = 'READY_FOR_EXECUTION',
  BLOCKED = 'BLOCKED'
}

export type DispatchInput = {
  id: string;
  capability: string;
  adapterId: string;
  input: unknown;
};

export type DispatchRequest = DispatchInput & {
  status: DispatchStatus;
  blockReason: string | null;
};

export function createDispatch(
  input: DispatchInput,
  adapters?: ToolAdapterRegistry
): DispatchRequest {
  if (!adapters) {
    return {
      ...input,
      status: DispatchStatus.BLOCKED,
      blockReason: 'DISPATCH_ADAPTER_REGISTRY_REQUIRED'
    };
  }

  const adapter = adapters.get(input.adapterId);
  if (!adapter) {
    return {
      ...input,
      status: DispatchStatus.BLOCKED,
      blockReason: 'DISPATCH_ADAPTER_NOT_FOUND'
    };
  }

  if (adapter.capability !== input.capability) {
    return {
      ...input,
      status: DispatchStatus.BLOCKED,
      blockReason: 'DISPATCH_CAPABILITY_MISMATCH'
    };
  }

  if (adapter.availability !== AdapterAvailability.AVAILABLE) {
    return {
      ...input,
      status: DispatchStatus.BLOCKED,
      blockReason: `DISPATCH_ADAPTER_${adapter.availability}`
    };
  }

  return {
    ...input,
    status: DispatchStatus.READY_FOR_EXECUTION,
    blockReason: null
  };
}
