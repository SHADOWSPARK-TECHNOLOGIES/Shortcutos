export enum SourceTrustGrade {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  UNTRUSTED = 'UNTRUSTED'
}

export type SourceRecord = {
  id: string;
  origin: string;
  grade: SourceTrustGrade;
};

export type ClaimRecord = {
  id: string;
  statement: string;
  sourceId: string;
  confidence: number;
};

export type EvidenceRelationType = 'SUPPORTS' | 'CONTRADICTS';

export type EvidenceRelation = {
  sourceClaimId: string;
  targetClaimId: string;
  type: EvidenceRelationType;
};

export type ConflictPair = {
  claimAId: string;
  claimBId: string;
};

export type VerificationTrace = {
  timestamp: string;
  claimId: string;
  action: 'ACCEPTED' | 'REJECTED';
  reason: string;
};

export type ReconciliationResult = {
  acceptedClaimIds: string[];
  rejectedClaimIds: string[];
  traces: VerificationTrace[];
};

export class EvidenceGraph {
  public readonly sources = new Map<string, SourceRecord>();
  public readonly claims = new Map<string, ClaimRecord>();
  public readonly relations: EvidenceRelation[] = [];

  addSource(source: SourceRecord): void {
    this.sources.set(source.id, { ...source });
  }

  addClaim(claim: ClaimRecord): void {
    this.claims.set(claim.id, { ...claim });
  }

  addRelation(sourceClaimId: string, targetClaimId: string, type: EvidenceRelationType): void {
    this.relations.push({ sourceClaimId, targetClaimId, type });
  }

  detectConflicts(): ConflictPair[] {
    const conflicts: ConflictPair[] = [];
    for (const rel of this.relations) {
      if (rel.type === 'CONTRADICTS') {
        conflicts.push({
          claimAId: rel.sourceClaimId,
          claimBId: rel.targetClaimId
        });
      }
    }
    return conflicts;
  }
}

const GRADE_NUMERIC: Record<SourceTrustGrade, number> = {
  [SourceTrustGrade.HIGH]: 4,
  [SourceTrustGrade.MEDIUM]: 3,
  [SourceTrustGrade.LOW]: 2,
  [SourceTrustGrade.UNTRUSTED]: 1
};

export function reconcileEvidenceConflicts(graph: EvidenceGraph): ReconciliationResult {
  const conflicts = graph.detectConflicts();
  const accepted = new Set<string>(graph.claims.keys());
  const rejected = new Set<string>();
  const traces: VerificationTrace[] = [];

  const now = new Date().toISOString();

  for (const conflict of conflicts) {
    const claimA = graph.claims.get(conflict.claimAId);
    const claimB = graph.claims.get(conflict.claimBId);

    if (!claimA || !claimB) continue;

    const sourceA = graph.sources.get(claimA.sourceId);
    const sourceB = graph.sources.get(claimB.sourceId);

    const gradeA = sourceA ? GRADE_NUMERIC[sourceA.grade] : 1;
    const gradeB = sourceB ? GRADE_NUMERIC[sourceB.grade] : 1;

    const scoreA = gradeA * 10 + claimA.confidence;
    const scoreB = gradeB * 10 + claimB.confidence;

    if (scoreA >= scoreB) {
      accepted.add(claimA.id);
      rejected.add(claimB.id);
      accepted.delete(claimB.id);

      traces.push({
        timestamp: now,
        claimId: claimA.id,
        action: 'ACCEPTED',
        reason: `Outranked claim ${claimB.id} (Score: ${scoreA.toFixed(2)} vs ${scoreB.toFixed(2)})`
      });
      traces.push({
        timestamp: now,
        claimId: claimB.id,
        action: 'REJECTED',
        reason: `Outranked by claim ${claimA.id}`
      });
    } else {
      accepted.add(claimB.id);
      rejected.add(claimA.id);
      accepted.delete(claimA.id);

      traces.push({
        timestamp: now,
        claimId: claimB.id,
        action: 'ACCEPTED',
        reason: `Outranked claim ${claimA.id} (Score: ${scoreB.toFixed(2)} vs ${scoreA.toFixed(2)})`
      });
      traces.push({
        timestamp: now,
        claimId: claimA.id,
        action: 'REJECTED',
        reason: `Outranked by claim ${claimB.id}`
      });
    }
  }

  return {
    acceptedClaimIds: Array.from(accepted),
    rejectedClaimIds: Array.from(rejected),
    traces
  };
}
