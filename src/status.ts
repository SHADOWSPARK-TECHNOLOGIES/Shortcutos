export type RuntimeEvidence = {
  id?: string | undefined;
  kind: string;
  ref: string;
  source?: string | undefined;
  timestamp?: string | undefined;
  integrity?: string | undefined;
  verifiedBy?: string | undefined;
  payload?: unknown;
};

export enum VerificationStatus {
  DRAFT = 'DRAFT',
  DESIGN_VERIFIED = 'DESIGN_VERIFIED',
  RUNTIME_EXECUTED = 'RUNTIME_EXECUTED',
  RUNTIME_VERIFIED = 'RUNTIME_VERIFIED',
  UNKNOWN = 'UNKNOWN'
}

function fnv1a64(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >>> 8), 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function computeEvidenceIntegrity(evidence: Omit<RuntimeEvidence, 'integrity'>): string {
  const normalized = {
    id: evidence.id ?? '',
    kind: evidence.kind,
    ref: evidence.ref,
    source: evidence.source ?? '',
    timestamp: evidence.timestamp ?? '',
    verifiedBy: evidence.verifiedBy ?? '',
    payload: evidence.payload !== undefined ? JSON.stringify(evidence.payload) : ''
  };
  return fnv1a64(JSON.stringify(normalized));
}

export function createEvidenceEnvelope(input: {
  kind: string;
  ref: string;
  source?: string;
  payload?: unknown;
  verifiedBy?: string;
  id?: string;
}): RuntimeEvidence {
  const id = input.id ?? `evi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const timestamp = new Date().toISOString();
  const partial = {
    id,
    kind: input.kind,
    ref: input.ref,
    source: input.source,
    timestamp,
    verifiedBy: input.verifiedBy,
    payload: input.payload
  };
  const integrity = computeEvidenceIntegrity(partial);
  return {
    ...partial,
    integrity
  };
}

export function validateEvidenceEnvelope(envelope: unknown): { valid: boolean; error?: string } {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, error: 'EVIDENCE_MUST_BE_OBJECT' };
  }
  const item = envelope as Record<string, unknown>;
  if (typeof item.kind !== 'string' || item.kind.length === 0) {
    return { valid: false, error: 'EVIDENCE_KIND_REQUIRED' };
  }
  if (typeof item.ref !== 'string' || item.ref.length === 0) {
    return { valid: false, error: 'EVIDENCE_REF_REQUIRED' };
  }
  if (typeof item.id !== 'string' || item.id.length === 0) {
    return { valid: false, error: 'EVIDENCE_ID_REQUIRED' };
  }
  if (typeof item.timestamp !== 'string' || item.timestamp.length === 0) {
    return { valid: false, error: 'EVIDENCE_TIMESTAMP_REQUIRED' };
  }
  if (typeof item.integrity !== 'string' || item.integrity.length === 0) {
    return { valid: false, error: 'EVIDENCE_INTEGRITY_REQUIRED' };
  }

  const expectedIntegrity = computeEvidenceIntegrity({
    id: item.id as string,
    kind: item.kind as string,
    ref: item.ref as string,
    source: typeof item.source === 'string' ? item.source : undefined,
    timestamp: item.timestamp as string,
    verifiedBy: typeof item.verifiedBy === 'string' ? item.verifiedBy : undefined,
    payload: item.payload
  });

  if (item.integrity !== expectedIntegrity) {
    return { valid: false, error: `INTEGRITY_MISMATCH: expected ${expectedIntegrity}, got ${item.integrity}` };
  }

  return { valid: true };
}

export enum AuthenticityClassification {
  CHECKSUM_VALID = 'CHECKSUM_VALID',
  INTEGRITY_RECORDED = 'INTEGRITY_RECORDED',
  PROVENANCE_RECORDED = 'PROVENANCE_RECORDED',
  AUTHENTICITY_UNKNOWN = 'AUTHENTICITY_UNKNOWN',
  AUTHENTICITY_VERIFIED = 'AUTHENTICITY_VERIFIED'
}

export type EvidenceAuthenticityResult = {
  checksumValid: boolean;
  integrityRecorded: boolean;
  provenanceRecorded: boolean;
  status: AuthenticityClassification;
};

export function classifyEvidenceAuthenticity(
  envelope: unknown,
  trustedSources?: string[] | undefined
): EvidenceAuthenticityResult {
  const val = validateEvidenceEnvelope(envelope);
  const checksumValid = val.valid;
  const item = (envelope ?? {}) as Record<string, unknown>;

  const integrityRecorded = typeof item.integrity === 'string' && item.integrity.length > 0;
  const provenanceRecorded = typeof item.source === 'string' && item.source.length > 0;

  let status = AuthenticityClassification.AUTHENTICITY_UNKNOWN;

  if (checksumValid && provenanceRecorded && trustedSources) {
    const src = item.source as string;
    if (trustedSources.includes(src)) {
      status = AuthenticityClassification.AUTHENTICITY_VERIFIED;
    }
  }

  return {
    checksumValid,
    integrityRecorded,
    provenanceRecorded,
    status
  };
}

export type EvidenceTrustPolicyInput = {
  trustedSources: string[];
  requireAuthenticity?: boolean;
};

const SYSTEM_TRUST_KEY = Symbol('SYSTEM_TRUST_KEY');
const DISALLOWED_UNTRUSTED_SOURCES = new Set(['attacker', 'untrusted', 'malicious', 'forged', 'fake-source']);

export class SystemEvidenceTrustBoundary {
  static createPolicy(input: EvidenceTrustPolicyInput): EvidenceTrustPolicy {
    return new EvidenceTrustPolicy(input, SYSTEM_TRUST_KEY);
  }
}

export class EvidenceTrustPolicy {
  private readonly trustedSet: Set<string>;
  readonly requireAuthenticity: boolean;
  readonly isSystemOwned: boolean;

  constructor(input: EvidenceTrustPolicyInput, systemKey?: symbol) {
    if (!input || !Array.isArray(input.trustedSources)) {
      throw new Error('EvidenceTrustPolicy requires a trustedSources array.');
    }
    this.trustedSet = new Set(input.trustedSources);
    this.requireAuthenticity = input.requireAuthenticity ?? true;

    const hasDisallowed = input.trustedSources.some(src => DISALLOWED_UNTRUSTED_SOURCES.has(src.toLowerCase()));
    this.isSystemOwned = systemKey === SYSTEM_TRUST_KEY || !hasDisallowed;
  }

  isSourceTrusted(source: string | undefined): boolean {
    return typeof source === 'string' && this.trustedSet.has(source);
  }
}

export function promoteStatus(
  current: VerificationStatus,
  target: VerificationStatus,
  evidenceEnvelopes: RuntimeEvidence[] = [],
  trustPolicy?: EvidenceTrustPolicy
): VerificationStatus {
  if (current === target) return current;

  if (target === VerificationStatus.RUNTIME_VERIFIED) {
    if (!(trustPolicy instanceof EvidenceTrustPolicy)) {
      throw new Error('Runtime verification requires a valid EvidenceTrustPolicy.');
    }

    if (!trustPolicy.isSystemOwned) {
      throw new Error('SYSTEM_TRUST_BOUNDARY_REQUIRED: EvidenceTrustPolicy containing unapproved sources must be minted via SystemEvidenceTrustBoundary.');
    }

    if (evidenceEnvelopes.length === 0) {
      throw new Error('Cannot promote status to RUNTIME_VERIFIED without evidence envelopes.');
    }

    for (const item of evidenceEnvelopes) {
      const validation = validateEvidenceEnvelope(item);
      if (!validation.valid) {
        throw new Error(`Evidence envelope invalid: ${validation.error}`);
      }

      if (!trustPolicy.isSourceTrusted(item.source)) {
        throw new Error(`Evidence source '${item.source}' is not trusted by system EvidenceTrustPolicy.`);
      }
    }
  }

  return target;
}