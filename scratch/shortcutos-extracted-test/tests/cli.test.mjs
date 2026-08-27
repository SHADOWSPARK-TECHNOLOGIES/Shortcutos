import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('self-check reports PASS and never claims host integration', () => {
  const stdout = execFileSync(process.execPath, ['cli.mjs', 'self-check'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.hostIntegrated, false);
  assert.equal(result.runtimeKernel, 'VERIFIED_BY_LOCAL_TESTS');
  assert.equal(result.checks.canonicalRegistry, true);
  assert.equal(result.checks.capabilityHonesty, true);
  assert.equal(result.checks.singleAttemptExecution, true);
  assert.equal(result.checks.persistentMemory, true);
  assert.equal(result.checks.localFileReadAdapter, true);
});
