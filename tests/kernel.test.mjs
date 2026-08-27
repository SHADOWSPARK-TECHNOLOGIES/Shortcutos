import test from 'node:test';
import assert from 'node:assert/strict';
import { ShortcutOSKernel } from '../dist/kernel.js';
import { VerificationStatus, createEvidenceEnvelope } from '../dist/status.js';

test('kernel does not claim completion when verification is missing', () => {
  const kernel = new ShortcutOSKernel();
  const run = kernel.createRun({ goal: 'build feature', acceptanceCriteria: ['tests pass'] });
  kernel.markPlanned(run.id);
  kernel.markExecuted(run.id, createEvidenceEnvelope({ kind: 'runtime', ref: 'attempt-1', source: 'ci-runner' }));
  assert.equal(run.verificationStatus, VerificationStatus.DRAFT);
});

test('kernel completes only after acceptance evidence is verified', () => {
  const kernel = new ShortcutOSKernel();
  const run = kernel.createRun({ goal: 'build feature', acceptanceCriteria: ['tests pass'] });
  kernel.markPlanned(run.id);
  kernel.markExecuted(run.id, createEvidenceEnvelope({ kind: 'runtime', ref: 'attempt-1', source: 'ci-runner' }));
  const verifiedRun = kernel.verify(run.id, [
    createEvidenceEnvelope({ kind: 'runtime-test', ref: 'test-suite-1', source: 'ci-runner', payload: { criteria: 'tests pass' } })
  ]);
  assert.equal(verifiedRun.verificationStatus, VerificationStatus.RUNTIME_VERIFIED);
  assert.equal(verifiedRun.completed, true);
});
