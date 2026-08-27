import test from 'node:test';
import assert from 'node:assert/strict';
import {
  promoteStatus,
  createEvidenceEnvelope,
  VerificationStatus,
  ShortcutOSKernel,
  EvidenceTrustPolicy
} from '../dist/index.js';
import { createLocalFileReadAdapter } from '../node-adapters.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('P3 Security: Tampered evidence envelope is rejected by promoteStatus and kernel', () => {
  const policy = new EvidenceTrustPolicy({ trustedSources: ['trusted-source'] });
  const validEnvelope = createEvidenceEnvelope({
    kind: 'test-evidence',
    ref: 'ref-1',
    source: 'trusted-source',
    payload: { test: true }
  });

  const tamperedEnvelope = {
    ...validEnvelope,
    payload: { test: false } // tampered payload invalidates integrity hash!
  };

  assert.throws(
    () => {
      promoteStatus(VerificationStatus.RUNTIME_EXECUTED, VerificationStatus.RUNTIME_VERIFIED, [tamperedEnvelope], policy);
    },
    (err) => {
      return err instanceof Error && (err.message.includes('invalid') || err.message.includes('INTEGRITY_MISMATCH'));
    }
  );

  const kernel = new ShortcutOSKernel({ trustPolicy: policy });
  const run = kernel.createRun({ goal: 'g', acceptanceCriteria: ['c'] });
  kernel.markPlanned(run.id);
  kernel.markExecuted(run.id, validEnvelope);

  const res = kernel.verify(run.id, [tamperedEnvelope]);
  assert.equal(res.completed, false);
  assert.equal(res.acceptancePassed, false);
});

test('P3 Security: Local file adapter handles non-existent paths outside root safely', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'shortcut-test-'));
  try {
    const adapter = createLocalFileReadAdapter({ id: 'file.reader', root: tempDir });

    await assert.rejects(
      async () => {
        await adapter.invoke({ path: '../non-existent-file.txt' });
      },
      (err) => {
        return err instanceof Error && err.message.includes('resolves outside configured root');
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
