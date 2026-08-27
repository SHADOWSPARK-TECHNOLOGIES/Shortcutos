import { AdapterAvailability, SideEffectClass, type ToolAdapterRegistry } from './adapter.js';
import { AuthorityLevel } from './authority.js';
import { ContextFreshness } from './context.js';

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

export type DispatchPreflightInput = {
  dispatch: DispatchInput;
  actorAuthority?: AuthorityLevel | undefined;
  adapters?: ToolAdapterRegistry | undefined;
  contextFreshness?: ContextFreshness | undefined;
  hasConflicts?: boolean | undefined;
  idempotencyKey?: string | null | undefined;
};

export type DispatchPreflightResult = {
  eligible: boolean;
  reasons: string[];
};

export function preflightDispatch(input: DispatchPreflightInput): DispatchPreflightResult {
  const reasons: string[] = [];

  if (!input.adapters) {
    reasons.push('PREFLIGHT_ADAPTER_REGISTRY_REQUIRED');
    return { eligible: false, reasons };
  }

  const adapter = input.adapters.get(input.dispatch.adapterId);
  if (!adapter) {
    reasons.push('PREFLIGHT_ADAPTER_NOT_FOUND');
    return { eligible: false, reasons };
  }

  if (adapter.capability !== input.dispatch.capability) {
    reasons.push('PREFLIGHT_CAPABILITY_MISMATCH');
  }

  if (adapter.availability !== AdapterAvailability.AVAILABLE) {
    reasons.push(`PREFLIGHT_ADAPTER_${adapter.availability}`);
  }

  if (
    adapter.requiredAuthority !== undefined &&
    input.actorAuthority !== undefined &&
    input.actorAuthority > adapter.requiredAuthority
  ) {
    reasons.push('PREFLIGHT_AUTHORITY_INSUFFICIENT');
  }

  const isMutation =
    adapter.sideEffectClass === SideEffectClass.NON_IDEMPOTENT_MUTATION ||
    adapter.sideEffectClass === SideEffectClass.IRREVERSIBLE;

  if (isMutation) {
    if (input.contextFreshness === ContextFreshness.STALE) {
      reasons.push('PREFLIGHT_CONTEXT_STALE');
    }
    if (input.hasConflicts) {
      reasons.push('PREFLIGHT_CONTEXT_CONFLICT');
    }
    if (!input.idempotencyKey) {
      reasons.push('PREFLIGHT_IDEMPOTENCY_REQUIRED');
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
}

export function createDispatch(
  input: DispatchInput,
  adapters?: ToolAdapterRegistry | undefined,
  options?: {
    actorAuthority?: AuthorityLevel | undefined;
    contextFreshness?: ContextFreshness | undefined;
    hasConflicts?: boolean | undefined;
    idempotencyKey?: string | null | undefined;
  } | undefined
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

  const preflight = preflightDispatch({
    dispatch: input,
    adapters,
    actorAuthority: options?.actorAuthority,
    contextFreshness: options?.contextFreshness,
    hasConflicts: options?.hasConflicts,
    idempotencyKey: options?.idempotencyKey
  });

  if (!preflight.eligible) {
    return {
      ...input,
      status: DispatchStatus.BLOCKED,
      blockReason: preflight.reasons.join('; ')
    };
  }

  return {
    ...input,
    status: DispatchStatus.READY_FOR_EXECUTION,
    blockReason: null
  };
}