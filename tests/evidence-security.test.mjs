import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvidenceEnvelope,
  validateEvidenceEnvelope,
  classifyEvidenceAuthenticity,
  AuthenticityClassification
} from '../dist/status.js';

test('PHASE E: Valid checksum does not equal trusted evidence source (distinguishes checksum vs authenticity)', () => {
  // An untrusted actor constructs a valid evidence envelope with valid FNV-1a64 checksum
  const untrustedEnvelope = createEvidenceEnvelope({
    kind: 'user-untrusted-log',
    ref: 'log-99',
    source: 'untrusted-client',
    payload: { claim: 'I paid $1000' }
  });

  // Checksum validation passes
  const checksumResult = validateEvidenceEnvelope(untrustedEnvelope);
  assert.equal(checksumResult.valid, true);

  // Authenticity classification correctly detects that checksum valid !== AUTHENTICITY_VERIFIED
  const authClass = classifyEvidenceAuthenticity(untrustedEnvelope, ['kernel-internal', 'system-trusted']);

  assert.equal(authClass.checksumValid, true);
  assert.equal(authClass.status, AuthenticityClassification.AUTHENTICITY_UNKNOWN);
  assert.notEqual(authClass.status, AuthenticityClassification.AUTHENTICITY_VERIFIED);

  // Trusted source produces AUTHENTICITY_VERIFIED
  const trustedEnvelope = createEvidenceEnvelope({
    kind: 'kernel-system-log',
    ref: 'log-100',
    source: 'system-trusted',
    verifiedBy: 'system-trusted',
    payload: { claim: 'Execution confirmed' }
  });

  const trustedAuthClass = classifyEvidenceAuthenticity(trustedEnvelope, ['kernel-internal', 'system-trusted']);
  assert.equal(trustedAuthClass.status, AuthenticityClassification.AUTHENTICITY_VERIFIED);
});
