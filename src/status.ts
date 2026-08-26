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

export function promoteStatus(
  current: VerificationStatus,
  target: VerificationStatus,
  evidence: RuntimeEvidence[]
): VerificationStatus {
  if (target === VerificationStatus.RUNTIME_EXECUTED && evidence.length === 0) {
    throw new Error('RUNTIME_EVIDENCE_REQUIRED');
  }
  if (target === VerificationStatus.RUNTIME_VERIFIED && evidence.length === 0) {
    throw new Error('RUNTIME_EVIDENCE_REQUIRED');
  }
  if (current === VerificationStatus.UNKNOWN && target === VerificationStatus.RUNTIME_VERIFIED && evidence.length === 0) {
    return VerificationStatus.UNKNOWN;
  }
  return target;
}