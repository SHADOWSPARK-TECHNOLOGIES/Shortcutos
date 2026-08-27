import type { RuntimeEvidence } from './status.js';
import { validateEvidenceEnvelope, classifyEvidenceAuthenticity, AuthenticityClassification } from './status.js';

export type AcceptanceEvaluationResult = {
  passed: boolean;
  unmetCriteria: string[];
  mappedEvidence: RuntimeEvidence[];
};

export function evaluateAcceptance(
  criteria: string[],
  evidence: RuntimeEvidence[],
  trustedSources?: string[]
): AcceptanceEvaluationResult {
  if (criteria.length === 0) {
    return { passed: true, unmetCriteria: [], mappedEvidence: [] };
  }

  if (evidence.length === 0) {
    return { passed: false, unmetCriteria: [...criteria], mappedEvidence: [] };
  }

  const validEvidence = evidence.filter((env) => {
    // Envelope MUST have full envelope metadata and pass integrity validation
    const val = validateEvidenceEnvelope(env);
    if (!val.valid) {
      return false;
    }
    // If trustedSources provided, envelope MUST be AUTHENTICITY_VERIFIED
    if (trustedSources) {
      const auth = classifyEvidenceAuthenticity(env, trustedSources);
      if (auth.status !== AuthenticityClassification.AUTHENTICITY_VERIFIED) {
        return false;
      }
    }
    return true;
  });

  const unmetCriteria: string[] = [];
  const mappedEvidence: RuntimeEvidence[] = [];

  for (const criterion of criteria) {
    const norm = criterion.toLowerCase().trim();
    const matched = validEvidence.find((env) => {
      if (typeof env.payload === 'object' && env.payload !== null) {
        const p = env.payload as Record<string, unknown>;
        if (typeof p.criteria === 'string' && p.criteria.toLowerCase().trim() === norm) {
          return p.satisfied !== false;
        }
      }
      const refMatch = env.ref.toLowerCase().includes(norm) || norm.includes(env.ref.toLowerCase());
      const kindMatch = env.kind.toLowerCase().includes(norm) || norm.includes(env.kind.toLowerCase());
      return refMatch || kindMatch;
    });

    if (matched) {
      if (!mappedEvidence.includes(matched)) {
        mappedEvidence.push(matched);
      }
    } else {
      unmetCriteria.push(criterion);
    }
  }

  return {
    passed: unmetCriteria.length === 0 && mappedEvidence.length > 0,
    unmetCriteria,
    mappedEvidence
  };
}