import { promoteStatus, type RuntimeEvidence, VerificationStatus } from './status.js';
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
  private sequence = 0;

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

  verify(runId: string, evidence: RuntimeEvidence[], acceptancePassed: boolean, trustedSources?: string[]): ShortcutRun {
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
    run.acceptancePassed = acceptancePassed;
    if (acceptancePassed) {
      run.verificationStatus = promoteStatus(
        run.verificationStatus,
        VerificationStatus.RUNTIME_VERIFIED,
        run.evidence,
        trustedSources
      );
      run.completed = true;
    } else {
      run.completed = false;
    }
    return structuredClone(run);
  }

  getRun(runId: string): ShortcutRun {
    return structuredClone(this.requireRun(runId));
  }

  private requireRun(runId: string): ShortcutRun {
    const run = this.runs.get(runId);
    if (!run) {
      throw new ShortcutOSError({
        code: 'RUN_NOT_FOUND',
        message: `No run exists with id ${runId}.`,
        scope: runId,
        retryable: false,
        safeNextAction: 'Create a run before operating on it.'
      });
    }
    return run;
  }
}
