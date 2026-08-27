import test from 'node:test';
import assert from 'node:assert/strict';
import { promoteStatus, VerificationStatus } from '../dist/status.js';

test('runtime verification requires runtime evidence', () => {
  assert.throws(
    () => promoteStatus(VerificationStatus.DESIGN_VERIFIED, VerificationStatus.RUNTIME_VERIFIED, []),
    /RUNTIME_EVIDENCE_REQUIRED/
  );
});

test('design verification can be represented without runtime verification', () => {
  const next = promoteStatus(VerificationStatus.DRAFT, VerificationStatus.DESIGN_VERIFIED, []);
  assert.equal(next, VerificationStatus.DESIGN_VERIFIED);
});
