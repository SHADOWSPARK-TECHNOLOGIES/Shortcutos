import { promoteStatus, type RuntimeEvidence, VerificationStatus, EvidenceTrustPolicy, SystemEvidenceTrustBoundary } from './status.js';
import { evaluateAcceptance } from './acceptance.js';
import { ShortcutOSError } from './errors.js';

export type RunInput = {
  goal: string;
  acceptanceCriteria: string[];
};

export type ShortcutRun = {
  id: string;
  goal: string;
  acceptanceCriteria: string[];
  planned: boolean;
  verificationStatus: VerificationStatus;
  evidence: RuntimeEvidence[];
  acceptancePassed: boolean | null;
  completed: boolean;
};

export class ShortcutOSKernel {
  private readonly runs = new Map<string, ShortcutRun>();
  private readonly trustPolicy: EvidenceTrustPolicy;
  private sequence = 0;

  constructor(options?: { trustPolicy?: EvidenceTrustPolicy }) {
    if (options?.trustPolicy && !options.trustPolicy.isSystemOwned) {
      throw new Error('SYSTEM_TRUST_BOUNDARY_REQUIRED: EvidenceTrustPolicy must be system-owned.');
    }
    this.trustPolicy = options?.trustPolicy ?? SystemEvidenceTrustBoundary.createPolicy({ trustedSources: ['system', 'kernel', 'ci-runner'] });
  }

  createRun(input: RunInput): ShortcutRun {
    this.sequence += 1;
    const run: ShortcutRun = {
      id: `run-${this.sequence}`,
      goal: input.goal,
      acceptanceCriteria: [...input.acceptanceCriteria],
      planned: false,
      verificationStatus: VerificationStatus.DRAFT,
      evidence: [],
      acceptancePassed: null,
      completed: false
    };
    this.runs.set(run.id, run);
    return structuredClone(run);
  }

  markPlanned(runId: string): ShortcutRun {
    const run = this.requireRun(runId);
    run.planned = true;
    run.verificationStatus = promoteStatus(run.verificationStatus, VerificationStatus.DESIGN_VERIFIED, []);
    return structuredClone(run);
  }

  markExecuted(runId: string, evidence: RuntimeEvidence): ShortcutRun {
    const run = this.requireRun(runId);
    if (!run.planned) {
      throw new ShortcutOSError({
        code: 'EXECUTION_PLAN_REQUIRED',
        message: 'A run must be planned before execution is recorded.',
        scope: runId,
        retryable: false,
        safeNextAction: 'Call markPlanned() before markExecuted().'
      });
    }
    if (!evidence) {
      throw new ShortcutOSError({
        code: 'EXECUTION_EVIDENCE_REQUIRED',
        message: 'Runtime execution evidence is required to mark execution.',
        scope: runId,
        retryable: false,
        safeNextAction: 'Provide valid RuntimeEvidence when calling markExecuted().'
      });
    }
    run.evidence.push(evidence);
    run.verificationStatus = promoteStatus(
      run.verificationStatus,
      VerificationStatus.RUNTIME_EXECUTED,
      run.evidence
    );
    run.completed = false;
    return structuredClone(run);
  }

  verify(runId: string, evidence: RuntimeEvidence[] = []): ShortcutRun {
    const run = this.requireRun(runId);
    if (run.verificationStatus !== VerificationStatus.RUNTIME_EXECUTED) {
      throw new ShortcutOSError({
        code: 'RUNTIME_EXECUTION_REQUIRED',
        message: 'Runtime verification requires a recorded runtime execution first.',
        scope: runId,
        retryable: false,
        safeNextAction: 'Record an actual execution before verifying the run.'
      });
    }

    run.evidence.push(...evidence);
    const evaluation = evaluateAcceptance(run.acceptanceCriteria, run.evidence, this.trustPolicy);
    run.acceptancePassed = evaluation.passed;

    if (evaluation.passed) {
      try {
        run.verificationStatus = promoteStatus(
          run.verificationStatus,
          VerificationStatus.RUNTIME_VERIFIED,
          run.evidence,
          this.trustPolicy
        );
        run.completed = true;
      } catch {
        run.verificationStatus = VerificationStatus.RUNTIME_EXECUTED;
        run.acceptancePassed = false;
        run.completed = false;
      }
    } else {
      run.completed = false;
    }

    return structuredClone(run);
  }

  private requireRun(runId: string): ShortcutRun {
    const run = this.runs.get(runId);
    if (!run) {
      throw new ShortcutOSError({
        code: 'RUN_NOT_FOUND',
        message: `Run '${runId}' does not exist.`,
        scope: runId,
        retryable: false,
        safeNextAction: 'Create a run before accessing it.'
      });
    }
    return run;
  }
}
