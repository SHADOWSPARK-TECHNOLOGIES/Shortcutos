import type { RuntimeEvidence } from './status.js';
import { validateEvidenceEnvelope } from './status.js';

export type AcceptanceEvaluationResult = {
  passed: boolean;
  unmetCriteria: string[];
  mappedEvidence: RuntimeEvidence[];
};

export function evaluateAcceptance(
  criteria: string[],
  evidence: RuntimeEvidence[]
): AcceptanceEvaluationResult {
  if (criteria.length === 0) {
    return { passed: true, unmetCriteria: [], mappedEvidence: [] };
  }

  if (evidence.length === 0) {
    return { passed: false, unmetCriteria: [...criteria], mappedEvidence: [] };
  }

  const validEvidence = evidence.filter((env) => {
    // If envelope has integrity, ensure it is valid
    if (env.integrity) {
      return validateEvidenceEnvelope(env).valid;
    }
    return Boolean(env.kind && env.ref);
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