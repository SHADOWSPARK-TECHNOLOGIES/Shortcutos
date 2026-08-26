import { spawnSync } from 'node:child_process';

const countPatterns = {
  discovered: /^# tests\s+(\d+)\s*$/m,
  passed: /^# pass\s+(\d+)\s*$/m,
  failed: /^# fail\s+(\d+)\s*$/m,
  skipped: /^# skipped\s+(\d+)\s*$/m
};

function readCount(output, pattern) {
  const match = pattern.exec(output);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function parseNodeTestSummary(output) {
  const text = String(output ?? '');
  return {
    discovered: readCount(text, countPatterns.discovered),
    passed: readCount(text, countPatterns.passed),
    failed: readCount(text, countPatterns.failed),
    skipped: readCount(text, countPatterns.skipped)
  };
}

export function classifyTestResult(exitCode, summary) {
  if (exitCode !== 0) return 'FAIL';
  if (summary.discovered === 0) return 'INVALID_ZERO_TESTS';
  if (summary.failed === 0 && summary.passed + summary.skipped === summary.discovered) {
    return 'PASS';
  }
  return 'UNKNOWN';
}

export function parseSelfCheck(stdout, exitCode) {
  let payload;
  try {
    payload = JSON.parse(String(stdout ?? ''));
  } catch {
    return {
      status: exitCode === 0 ? 'UNKNOWN' : 'FAIL',
      hostIntegrated: null
    };
  }

  const hostIntegrated = typeof payload?.hostIntegrated === 'boolean'
    ? payload.hostIntegrated
    : null;

  if (exitCode !== 0) {
    return { status: 'FAIL', hostIntegrated };
  }

  return {
    status: payload?.status === 'PASS' ? 'PASS' : 'UNKNOWN',
    hostIntegrated
  };
}

export function captureCommandEvidence(command, args = [], options = {}) {
  const spawn = options.spawn ?? spawnSync;
  const startedAt = new Date().toISOString();
  let result;

  try {
    result = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      encoding: 'utf8'
    });
  } catch (error) {
    result = { status: null, stdout: '', stderr: '', error };
  }

  const finishedAt = new Date().toISOString();
  const errorText = result?.error instanceof Error ? result.error.message : '';
  const stderr = [String(result?.stderr ?? ''), errorText].filter(Boolean).join('\n');

  return {
    command: [command, ...args].join(' ').trim(),
    exitCode: Number.isInteger(result?.status) ? result.status : -1,
    stdout: String(result?.stdout ?? ''),
    stderr,
    startedAt,
    finishedAt
  };
}

function trimLine(value) {
  return String(value ?? '').trim();
}

export function runPrimitiveConformance({ root, runCommand = captureCommandEvidence }) {
  if (!root) {
    throw new Error('CONFORMANCE_ROOT_REQUIRED');
  }

  const invoke = (command, args = [], extra = {}) => runCommand(command, args, {
    cwd: root,
    ...extra
  });

  const commitEvidence = invoke('git', ['rev-parse', 'HEAD']);
  const statusEvidence = invoke('git', ['status', '--porcelain']);
  const nodeEvidence = invoke('node', ['--version']);
  const npmEvidence = invoke('npm', ['--version']);
  const build = invoke('npm', ['run', 'build']);
  const rawTests = invoke('node', ['--test', 'tests/*.test.mjs'], { shell: true });
  const rawSelfCheck = invoke('node', ['cli.mjs', 'self-check']);

  const summary = parseNodeTestSummary(rawTests.stdout);
  const tests = {
    ...rawTests,
    ...summary,
    status: classifyTestResult(rawTests.exitCode, summary)
  };

  const selfCheckParsed = parseSelfCheck(rawSelfCheck.stdout, rawSelfCheck.exitCode);
  const selfCheck = {
    ...rawSelfCheck,
    ...selfCheckParsed
  };

  return {
    schemaVersion: '1.0',
    repository: {
      commit: trimLine(commitEvidence.stdout),
      dirty: trimLine(statusEvidence.stdout).length > 0
    },
    environment: {
      node: trimLine(nodeEvidence.stdout),
      npm: trimLine(npmEvidence.stdout)
    },
    build,
    tests,
    selfCheck
  };
}
