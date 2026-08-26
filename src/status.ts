export type RuntimeEvidence = {
  kind: string;
  ref: string;
};

export enum VerificationStatus {
  DRAFT = 'DRAFT',
  DESIGN_VERIFIED = 'DESIGN_VERIFIED',
  RUNTIME_EXECUTED = 'RUNTIME_EXECUTED',
  RUNTIME_VERIFIED = 'RUNTIME_VERIFIED',
  UNKNOWN = 'UNKNOWN'
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
