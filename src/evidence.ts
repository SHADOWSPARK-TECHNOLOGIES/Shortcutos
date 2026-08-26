export enum EvidenceStatus {
  SOURCE_PRESENT = 'SOURCE_PRESENT',
  VERIFIED_SUPPORT = 'VERIFIED_SUPPORT',
  VERIFIED_REFUTATION = 'VERIFIED_REFUTATION',
  UNKNOWN = 'UNKNOWN'
}

export enum ClaimVerificationStatus {
  VERIFIED = 'VERIFIED',
  SUPPORTED = 'SUPPORTED',
  UNVERIFIED = 'UNVERIFIED',
  REFUTED = 'REFUTED',
  CONTRADICTED = 'CONTRADICTED',
  UNKNOWN = 'UNKNOWN'
}

export type EvidenceRecord = {
  id: string;
  status: EvidenceStatus;
};

export type ClaimVerificationResult = {
  claimId: string;
  status: ClaimVerificationStatus;
  evidenceIds: string[];
};

export function verifyClaim(claimId: string, evidence: EvidenceRecord[]): ClaimVerificationResult {
  const hasSupport = evidence.some((item) => item.status === EvidenceStatus.VERIFIED_SUPPORT);
  const hasRefutation = evidence.some((item) => item.status === EvidenceStatus.VERIFIED_REFUTATION);

  let status = ClaimVerificationStatus.UNVERIFIED;
  if (hasSupport && hasRefutation) status = ClaimVerificationStatus.CONTRADICTED;
  else if (hasSupport) status = ClaimVerificationStatus.SUPPORTED;
  else if (hasRefutation) status = ClaimVerificationStatus.REFUTED;
  else if (evidence.some((item) => item.status === EvidenceStatus.UNKNOWN)) status = ClaimVerificationStatus.UNKNOWN;

  return { claimId, status, evidenceIds: evidence.map((item) => item.id) };
}
