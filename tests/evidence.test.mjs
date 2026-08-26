import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaim, ClaimVerificationStatus, EvidenceStatus } from '../dist/evidence.js';

test('source presence does not verify a claim', () => {
  const result = verifyClaim('claim-1', [{ id: 'ev-1', status: EvidenceStatus.SOURCE_PRESENT }]);
  assert.equal(result.status, ClaimVerificationStatus.UNVERIFIED);
});

test('verified supporting evidence supports a claim', () => {
  const result = verifyClaim('claim-1', [{ id: 'ev-1', status: EvidenceStatus.VERIFIED_SUPPORT }]);
  assert.equal(result.status, ClaimVerificationStatus.SUPPORTED);
});

test('verified support and refutation remain contradicted', () => {
  const result = verifyClaim('claim-1', [
    { id: 'ev-1', status: EvidenceStatus.VERIFIED_SUPPORT },
    { id: 'ev-2', status: EvidenceStatus.VERIFIED_REFUTATION }
  ]);
  assert.equal(result.status, ClaimVerificationStatus.CONTRADICTED);
});
