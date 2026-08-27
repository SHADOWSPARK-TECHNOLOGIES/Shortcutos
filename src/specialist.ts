import { AuthorityLevel } from './authority.js';

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

export type DomainSpecialist = {
  role: SpecialistRole;
  requiredCapabilities: string[];
  capabilities: string[];
  minAuthorityLevel: AuthorityLevel;
};

const DOMAIN_CAPABILITIES: Record<SpecialistRole, string[]> = {
  [SpecialistRole.RESEARCH]: ['file.read', 'search.query'],
  [SpecialistRole.SOFTWARE_ENGINEERING]: ['file.read', 'file.write', 'build.execute'],
  [SpecialistRole.ARCHITECTURE]: ['system.model', 'schema.design'],
  [SpecialistRole.SECURITY]: ['security.audit', 'vulnerability.scan'],
  [SpecialistRole.BUSINESS]: ['requirements.analyze', 'policy.evaluate'],
  [SpecialistRole.CONTENT]: ['content.generate', 'documentation.write'],
  [SpecialistRole.MARKETING]: ['outreach.plan', 'campaign.analyze'],
  [SpecialistRole.AUTOMATION]: ['script.orchestrate', 'workflow.automate']
};

export function createSpecialist(role: SpecialistRole): DomainSpecialist {
  const caps = DOMAIN_CAPABILITIES[role] ?? ['generic.execute'];
  return {
    role,
    requiredCapabilities: [...caps],
    capabilities: [...caps],
    minAuthorityLevel: AuthorityLevel.SHORTCUTOS
  };
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

export function executeSpecialistHandoff(
  arg1: HandoffRequest | DomainSpecialist,
  arg2: SpecialistRegistry | DomainSpecialist,
  arg3?: Record<string, unknown>
): Promise<HandoffResult> | HandoffResult {
  if ('role' in arg1 && 'role' in arg2) {
    const fromSpec = arg1 as DomainSpecialist;
    const toSpec = arg2 as DomainSpecialist;
    const payload = (arg3 ?? {}) as Record<string, unknown>;

    const taskCap = typeof payload.task === 'string' && payload.task.includes('security') ? 'security.audit' : undefined;
    if (taskCap && !toSpec.capabilities.includes(taskCap)) {
      throw new Error(`SPECIALIST_POLICY_VIOLATION: Specialist ${toSpec.role} lacks required capability ${taskCap}`);
    }

    const requiredForTo = DOMAIN_CAPABILITIES[toSpec.role] ?? [];
    for (const reqCap of requiredForTo) {
      if (!toSpec.capabilities.includes(reqCap)) {
        throw new Error(`SPECIALIST_POLICY_VIOLATION: Specialist ${toSpec.role} lacks required capability ${reqCap}`);
      }
    }

    return {
      status: 'SUCCESS',
      executingSpecialistId: toSpec.role,
      output: { handoffAccepted: true, from: fromSpec.role, to: toSpec.role, payload },
      evidenceRef: `handoff-${fromSpec.role}-${toSpec.role}`
    };
  }

  const request = arg1 as HandoffRequest;
  const registry = arg2 as SpecialistRegistry;

  const fromSpec = registry.get(request.fromSpecialistId);
  const toSpec = registry.get(request.toSpecialistId);

  if (!fromSpec || !toSpec) {
    throw new Error('HANDOFF_SPECIALIST_NOT_FOUND');
  }

  if (!toSpec.capabilities.includes(request.capability)) {
    throw new Error(`HANDOFF_INELIGIBLE_CAPABILITY: Specialist ${toSpec.id} does not support ${request.capability}`);
  }

  return (async () => {
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
  })();
}
