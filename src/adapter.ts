import type { RuntimeEvidence } from './status.js';

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

export type ToolInvocationResult = {
  status: ExecutionResultStatus;
  output: unknown;
  evidence: RuntimeEvidence[];
};

export type ToolAdapter = {
  id: string;
  capability: string;
  availability: AdapterAvailability;
  invoke(input: unknown): Promise<ToolInvocationResult>;
};

export class ToolAdapterRegistry {
  private readonly adapters = new Map<string, ToolAdapter>();

  register(adapter: ToolAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`ADAPTER_ID_COLLISION:${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ToolAdapter | undefined {
    return this.adapters.get(id);
  }
}
