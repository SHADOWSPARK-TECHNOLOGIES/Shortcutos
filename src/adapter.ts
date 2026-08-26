import type { RuntimeEvidence } from './status.js';
import { AuthorityLevel, canOverride } from './authority.js';

export enum AdapterAvailability {
  AVAILABLE = 'AVAILABLE',
  RESTRICTED = 'RESTRICTED',
  UNAVAILABLE = 'UNAVAILABLE',
  UNKNOWN = 'UNKNOWN'
}

export enum ExecutionResultStatus {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
  NOT_PERFORMED = 'NOT_PERFORMED'
}

export enum SideEffectClass {
  READ_ONLY = 'READ_ONLY',
  IDEMPOTENT_WRITE = 'IDEMPOTENT_WRITE',
  NON_IDEMPOTENT_MUTATION = 'NON_IDEMPOTENT_MUTATION',
  IRREVERSIBLE = 'IRREVERSIBLE'
}

export type ToolInvocationOptions = {
  timeoutMs?: number;
  abortSignal?: AbortSignal;
};

export type ToolInvocationResult = {
  status: ExecutionResultStatus;
  output: unknown;
  evidence: RuntimeEvidence[];
};

export type ToolAdapter = {
  id: string;
  capability: string;
  availability: AdapterAvailability;
  sideEffectClass?: SideEffectClass;
  requiredAuthority?: AuthorityLevel;
  registeredBy?: string;
  authorityLevel?: AuthorityLevel;
  invoke(input: unknown, options?: ToolInvocationOptions): Promise<ToolInvocationResult>;
};

export class ToolAdapterRegistry {
  private readonly adapters = new Map<string, ToolAdapter>();

  register(adapter: ToolAdapter): void {
    const existing = this.adapters.get(adapter.id);
    if (existing) {
      if (
        existing.authorityLevel !== undefined &&
        adapter.authorityLevel !== undefined &&
        !canOverride(adapter.authorityLevel, existing.authorityLevel)
      ) {
        throw new Error(`ADAPTER_AUTHORITY_INSUFFICIENT:${adapter.id}`);
      }
      throw new Error(`ADAPTER_ID_COLLISION:${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ToolAdapter | undefined {
    return this.adapters.get(id);
  }
}