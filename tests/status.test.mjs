import test from 'node:test';
import assert from 'node:assert/strict';
import { promoteStatus, VerificationStatus, EvidenceTrustPolicy } from '../dist/status.js';

test('runtime verification requires runtime evidence and EvidenceTrustPolicy', () => {
  const policy = new EvidenceTrustPolicy({ trustedSources: ['ci-runner'] });
  assert.throws(
    () => promoteStatus(VerificationStatus.DESIGN_VERIFIED, VerificationStatus.RUNTIME_VERIFIED, [], policy),
    (err) => err instanceof Error && err.message.includes('evidence')
  );
});

test('design verification can be represented without runtime verification', () => {
  const next = promoteStatus(VerificationStatus.DRAFT, VerificationStatus.DESIGN_VERIFIED, []);
  assert.equal(next, VerificationStatus.DESIGN_VERIFIED);
});
