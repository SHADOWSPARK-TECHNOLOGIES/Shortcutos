import test from 'node:test';
import assert from 'node:assert/strict';
import { ShortcutOSKernel } from '../dist/kernel.js';
import { VerificationStatus } from '../dist/status.js';

test('kernel does not claim completion when verification is missing', () => {
  const kernel = new ShortcutOSKernel();
  const run = kernel.createRun({ goal: 'build feature', acceptanceCriteria: ['tests pass'] });
  kernel.markPlanned(run.id);
  kernel.markExecuted(run.id, { kind: 'runtime', ref: 'attempt-1' });
  const state = kernel.getRun(run.id);
  assert.equal(state.verificationStatus, VerificationStatus.RUNTIME_EXECUTED);
  assert.equal(state.completed, false);
});

test('kernel completes only after acceptance evidence is verified', () => {
  const kernel = new ShortcutOSKernel();
  const run = kernel.createRun({ goal: 'build feature', acceptanceCriteria: ['tests pass'] });
  kernel.markPlanned(run.id);
  kernel.markExecuted(run.id, { kind: 'runtime', ref: 'attempt-1' });
  kernel.verify(run.id, [{ kind: 'runtime-test', ref: 'test-suite-1' }], true);
  const state = kernel.getRun(run.id);
  assert.equal(state.verificationStatus, VerificationStatus.RUNTIME_VERIFIED);
  assert.equal(state.completed, true);
});
