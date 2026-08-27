export enum SpecialistRole {
  RESEARCH = 'RESEARCH',
  SOFTWARE_ENGINEERING = 'SOFTWARE_ENGINEERING',
  ARCHITECTURE = 'ARCHITECTURE',
  SECURITY = 'SECURITY',
  BUSINESS = 'BUSINESS',
  CONTENT = 'CONTENT',
  MARKETING = 'MARKETING',
  AUTOMATION = 'AUTOMATION'
}

export type SpecialistTask = {
  capability: string;
  input: Record<string, unknown>;
};

export type SpecialistExecutionResult = {
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN';
  output: Record<string, unknown>;
  evidenceRef: string;
};

export type SpecialistDefinition = {
  id: string;
  role: SpecialistRole;
  capabilities: string[];
  execute: (task: SpecialistTask) => Promise<SpecialistExecutionResult>;
};

export class SpecialistRegistry {
  private readonly specialists = new Map<string, SpecialistDefinition>();

  register(specialist: SpecialistDefinition): void {
    if (this.specialists.has(specialist.id)) {
      throw new Error(`SPECIALIST_DUPLICATE_ID: ${specialist.id}`);
    }
    this.specialists.set(specialist.id, { ...specialist });
  }

  get(id: string): SpecialistDefinition | undefined {
    return this.specialists.get(id);
  }

  findEligibleSpecialist(capability: string): SpecialistDefinition | undefined {
    for (const spec of this.specialists.values()) {
      if (spec.capabilities.includes(capability)) {
        return spec;
      }
    }
    return undefined;
  }
}

export type HandoffRequest = {
  fromSpecialistId: string;
  toSpecialistId: string;
  capability: string;
  input: Record<string, unknown>;
};

export type HandoffResult = {
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN';
  executingSpecialistId: string;
  output: Record<string, unknown>;
  evidenceRef: string;
};

export async function executeSpecialistHandoff(
  request: HandoffRequest,
  registry: SpecialistRegistry
): Promise<HandoffResult> {
  const fromSpec = registry.get(request.fromSpecialistId);
  const toSpec = registry.get(request.toSpecialistId);

  if (!fromSpec || !toSpec) {
    throw new Error('HANDOFF_SPECIALIST_NOT_FOUND');
  }

  if (!toSpec.capabilities.includes(request.capability)) {
    throw new Error(`HANDOFF_INELIGIBLE_CAPABILITY: Specialist ${toSpec.id} does not support ${request.capability}`);
  }

  const res = await toSpec.execute({
    capability: request.capability,
    input: request.input
  });

  return {
    status: res.status,
    executingSpecialistId: toSpec.id,
    output: res.output,
    evidenceRef: res.evidenceRef
  };
}
