import { EvidenceTrustPolicy, validateEvidenceEnvelope, type RuntimeEvidence } from './status.js';

export type AcceptanceEvaluation = {
  passed: boolean;
  unmetCriteria: string[];
};

export function evaluateAcceptance(
  criteria: string[] = [],
  evidence: RuntimeEvidence[] = [],
  trustPolicy?: EvidenceTrustPolicy
): AcceptanceEvaluation {
  if (criteria.length === 0) {
    return { passed: true, unmetCriteria: [] };
  }

  if (!(trustPolicy instanceof EvidenceTrustPolicy)) {
    return { passed: false, unmetCriteria: [...criteria] };
  }

  const met = new Set<string>();

  for (const item of evidence) {
    const val = validateEvidenceEnvelope(item);
    if (!val.valid) continue;
    if (!trustPolicy.isSourceTrusted(item.source ?? '')) continue;

    const payload = item.payload;
    if (payload && typeof payload === 'object' && payload !== null) {
      const satisfiedCriteria = (payload as Record<string, unknown>).criteria;
      if (typeof satisfiedCriteria === 'string') {
        met.add(satisfiedCriteria);
      } else if (Array.isArray(satisfiedCriteria)) {
        for (const c of satisfiedCriteria) {
          if (typeof c === 'string') met.add(c);
        }
      }
    }
  }

  const unmetCriteria = criteria.filter((c) => !met.has(c));
  return {
    passed: unmetCriteria.length === 0,
    unmetCriteria
  };
}