export enum SourceTrustGrade {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  UNTRUSTED = 'UNTRUSTED'
}
import { RuntimeEvidence } from './status.js';

export type SourceRecord = {
  id: string;
  origin: string;
  grade: SourceTrustGrade;
};

export type ClaimType =
  | 'fact'
  | 'forecast'
  | 'opinion'
  | 'recommendation'
  | 'definition'
  | 'causal'
  | 'numeric'
  | 'comparative';

export type ClaimRecord = {
  id: string;
  statement: string;
  sourceId: string;
  confidence: number;
  claimType?: ClaimType | string | undefined;
  subject?: string | undefined;
  predicate?: string | undefined;
  qualifier?: string | undefined;
  quantifier?: string | undefined;
  temporalScope?: string | undefined;
  geographicScope?: string | undefined;
  fingerprint?: string | undefined;
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
        reason: `Outranked by claim ${claimA.id}`
      });
    }
  }

  return {
    acceptedClaimIds: Array.from(accepted),
    rejectedClaimIds: Array.from(rejected),
    traces
  };
}

function computeFingerprint(statement: string, type?: string, subject?: string): string {
  const raw = `${type ?? 'fact'}:${subject ?? 'general'}:${statement}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return `fp-${Math.abs(hash).toString(16)}`;
}

export function extractClaimsFromEvidence(envelope: RuntimeEvidence): ClaimRecord[] {
  const claims: ClaimRecord[] = [];
  const sourceId = envelope.source || envelope.id || 'unknown-source';
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;

  if (Array.isArray(payload.findings)) {
    payload.findings.forEach((finding: unknown, index: number) => {
      if (typeof finding === 'object' && finding !== null) {
        const item = finding as Record<string, unknown>;
        const statement = String(item.statement ?? item.finding ?? JSON.stringify(item));
        const claimType = String(item.claimType ?? item.type ?? 'fact');
        const subject = typeof item.subject === 'string' ? item.subject : undefined;
        const predicate = typeof item.predicate === 'string' ? item.predicate : undefined;
        const quantifier = typeof item.quantifier === 'string' ? item.quantifier : undefined;
        const fingerprint = computeFingerprint(statement, claimType, subject);

        claims.push({
          id: `claim-${envelope.id}-${index}`,
          statement,
          sourceId,
          confidence: envelope.integrity === 'checksum-valid' ? 1.0 : 0.5,
          claimType,
          subject,
          predicate,
          quantifier,
          fingerprint
        });
      } else {
        const statement = String(finding);
        const claimType = statement.toLowerCase().includes('recommend')
          ? 'recommendation'
          : statement.match(/\d+/)
          ? 'numeric'
          : 'fact';
        claims.push({
          id: `claim-${envelope.id}-${index}`,
          statement,
          sourceId,
          confidence: envelope.integrity === 'checksum-valid' ? 1.0 : 0.5,
          claimType,
          fingerprint: computeFingerprint(statement, claimType)
        });
      }
    });
  } else if (typeof payload.message === 'string') {
    const statement = payload.message;
    const claimType = 'fact';
    claims.push({
      id: `claim-${envelope.id}-0`,
      statement,
      sourceId,
      confidence: envelope.integrity === 'checksum-valid' ? 1.0 : 0.5,
      claimType,
      fingerprint: computeFingerprint(statement, claimType)
    });
  } else {
    const statement = `${envelope.kind} evaluated on ${envelope.ref}`;
    const claimType = 'fact';
    claims.push({
      id: `claim-${envelope.id}-0`,
      statement,
      sourceId,
      confidence: envelope.integrity === 'checksum-valid' ? 1.0 : 0.5,
      claimType,
      fingerprint: computeFingerprint(statement, claimType)
    });
  }

  return claims;
}
