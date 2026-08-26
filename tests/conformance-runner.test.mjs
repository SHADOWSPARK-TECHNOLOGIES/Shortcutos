import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  parseNodeTestSummary,
  classifyTestResult,
  parseSelfCheck,
  captureCommandEvidence,
  runPrimitiveConformance
} from '../scripts/conformance-lib.mjs';

test('parses Node TAP summary counts', () => {
  assert.deepEqual(
    parseNodeTestSummary('# tests 28\n# pass 28\n# fail 0\n# skipped 0\n'),
    { discovered: 28, passed: 28, failed: 0, skipped: 0 }
  );
});

test('missing TAP summary fields remain zero rather than invented', () => {
  assert.deepEqual(parseNodeTestSummary('TAP version 13\n'), {
    discovered: 0,
    passed: 0,
    failed: 0,
    skipped: 0
  });
});

test('zero discovered tests cannot be PASS even with exit zero', () => {
  assert.equal(
    classifyTestResult(0, { discovered: 0, passed: 0, failed: 0, skipped: 0 }),
    'INVALID_ZERO_TESTS'
  );
});

test('non-zero test exit is FAIL', () => {
  assert.equal(
    classifyTestResult(1, { discovered: 2, passed: 1, failed: 1, skipped: 0 }),
    'FAIL'
  );
});

test('non-zero discovery with zero failures is PASS', () => {
  assert.equal(
    classifyTestResult(0, { discovered: 2, passed: 2, failed: 0, skipped: 0 }),
    'PASS'
  );
});

test('inconsistent zero-exit summary remains UNKNOWN', () => {
  assert.equal(
    classifyTestResult(0, { discovered: 2, passed: 1, failed: 0, skipped: 0 }),
    'UNKNOWN'
  );
});

test('self-check parser preserves explicit hostIntegrated false', () => {
  assert.deepEqual(
    parseSelfCheck('{"status":"PASS","hostIntegrated":false}', 0),
    { status: 'PASS', hostIntegrated: false }
  );
});

test('malformed self-check output remains UNKNOWN without invented host state', () => {
  assert.deepEqual(parseSelfCheck('not-json', 0), {
    status: 'UNKNOWN',
    hostIntegrated: null
  });
});

test('non-zero self-check exit is FAIL even if payload says PASS', () => {
  assert.deepEqual(
    parseSelfCheck('{"status":"PASS","hostIntegrated":false}', 2),
    { status: 'FAIL', hostIntegrated: false }
  );
});

test('command evidence invokes the command exactly once on failure', () => {
  let invocations = 0;
  const fakeSpawn = (command, args, options) => {
    invocations += 1;
    assert.equal(command, 'fake-command');
    assert.deepEqual(args, ['--flag']);
    assert.equal(options.encoding, 'utf8');
    return { status: 9, stdout: 'partial', stderr: 'boom' };
  };

  const evidence = captureCommandEvidence('fake-command', ['--flag'], {
    spawn: fakeSpawn
  });

  assert.equal(invocations, 1);
  assert.equal(evidence.exitCode, 9);
  assert.equal(evidence.stdout, 'partial');
  assert.equal(evidence.stderr, 'boom');
  assert.equal(evidence.command, 'fake-command --flag');
});

test('spawn errors are captured as structured command evidence', () => {
  const evidence = captureCommandEvidence('missing-command', [], {
    spawn: () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT synthetic')
    })
  });

  assert.equal(evidence.exitCode, -1);
  assert.match(evidence.stderr, /ENOENT synthetic/);
});


test('primitive report captures repository, environment, build, test and self-check facts', () => {
  const responses = new Map([
    ['git rev-parse HEAD', evidence('git rev-parse HEAD', 0, 'abc123\n')],
    ['git status --porcelain', evidence('git status --porcelain', 0, ' M src/kernel.ts\n')],
    ['node --version', evidence('node --version', 0, 'v22.16.0\n')],
    ['npm --version', evidence('npm --version', 0, '10.9.2\n')],
    ['npm run build', evidence('npm run build', 0, 'compiled\n')],
    ['node --test tests/*.test.mjs', evidence('node --test tests/*.test.mjs', 0, '# tests 3\n# pass 3\n# fail 0\n# skipped 0\n')],
    ['node cli.mjs self-check', evidence('node cli.mjs self-check', 0, '{"status":"PASS","hostIntegrated":false}\n')]
  ]);
  const seen = [];
  const runCommand = (command, args = []) => {
    const key = [command, ...args].join(' ');
    seen.push(key);
    const result = responses.get(key);
    assert.ok(result, `unexpected command ${key}`);
    return result;
  };

  const report = runPrimitiveConformance({ root: '/repo', runCommand });

  assert.deepEqual(seen, [
    'git rev-parse HEAD',
    'git status --porcelain',
    'node --version',
    'npm --version',
    'npm run build',
    'node --test tests/*.test.mjs',
    'node cli.mjs self-check'
  ]);
  assert.equal(report.schemaVersion, '1.0');
  assert.equal(report.repository.commit, 'abc123');
  assert.equal(report.repository.dirty, true);
  assert.equal(report.environment.node, 'v22.16.0');
  assert.equal(report.environment.npm, '10.9.2');
  assert.equal(report.tests.discovered, 3);
  assert.equal(report.tests.status, 'PASS');
  assert.equal(report.selfCheck.status, 'PASS');
  assert.equal(report.selfCheck.hostIntegrated, false);
});

test('primitive report preserves verification failures instead of short-circuiting', () => {
  const responses = new Map([
    ['git rev-parse HEAD', evidence('git rev-parse HEAD', 0, 'deadbeef\n')],
    ['git status --porcelain', evidence('git status --porcelain', 0, '')],
    ['node --version', evidence('node --version', 0, 'v22.16.0\n')],
    ['npm --version', evidence('npm --version', 0, '10.9.2\n')],
    ['npm run build', evidence('npm run build', 2, '', 'compile failed')],
    ['node --test tests/*.test.mjs', evidence('node --test tests/*.test.mjs', 1, '# tests 2\n# pass 1\n# fail 1\n# skipped 0\n', 'test failed')],
    ['node cli.mjs self-check', evidence('node cli.mjs self-check', 1, '{"status":"FAIL","hostIntegrated":false}\n')]
  ]);
  let calls = 0;
  const report = runPrimitiveConformance({
    root: '/repo',
    runCommand(command, args = []) {
      calls += 1;
      const key = [command, ...args].join(' ');
      const result = responses.get(key);
      assert.ok(result, `unexpected command ${key}`);
      return result;
    }
  });

  assert.equal(calls, 7);
  assert.equal(report.build.exitCode, 2);
  assert.equal(report.tests.exitCode, 1);
  assert.equal(report.tests.status, 'FAIL');
  assert.equal(report.selfCheck.exitCode, 1);
  assert.equal(report.selfCheck.status, 'FAIL');
  assert.equal(report.repository.dirty, false);
});

function evidence(command, exitCode, stdout = '', stderr = '') {
  return {
    command,
    exitCode,
    stdout,
    stderr,
    startedAt: '2026-08-26T00:00:00.000Z',
    finishedAt: '2026-08-26T00:00:00.001Z'
  };
}


test('CLI writes real primitive evidence with non-zero test discovery', {
  skip: process.env.SHORTCUTOS_CONFORMANCE_NESTED === '1'
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'shortcutos-conformance-'));
  const output = join(dir, 'report.json');
  try {
    const childEnv = { ...process.env, SHORTCUTOS_CONFORMANCE_NESTED: '1' };
    delete childEnv.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['scripts/run-conformance.mjs', '--output', output], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: childEnv
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.schemaVersion, '1.0');
    assert.ok(report.repository.commit.length > 0);
    assert.ok(report.tests.discovered > 0);
    assert.equal(report.tests.status, 'PASS');
    assert.equal(report.selfCheck.status, 'PASS');
    assert.equal(report.selfCheck.hostIntegrated, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
