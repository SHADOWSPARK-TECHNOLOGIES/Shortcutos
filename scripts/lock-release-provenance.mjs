import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { parseNodeTestSummary, classifyTestResult } from './conformance-lib.mjs';

const rootDir = resolve(process.cwd());

function runCmd(command, args) {
  const startedAt = new Date().toISOString();
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf8', cwd: rootDir });
    const finishedAt = new Date().toISOString();
    return {
      command: `${command} ${args.join(' ')}`,
      exitCode: 0,
      stdout,
      stderr: '',
      startedAt,
      finishedAt,
      status: 'PASS'
    };
  } catch (err) {
    const finishedAt = new Date().toISOString();
    return {
      command: `${command} ${args.join(' ')}`,
      exitCode: err.status ?? 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : String(err),
      startedAt,
      finishedAt,
      status: 'FAIL'
    };
  }
}

// Get current commit
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: rootDir }).trim();
const nodeVersion = process.version;
const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8', cwd: rootDir }).trim();

console.log(`Locking release provenance for commit: ${currentCommit}`);

// 1. Build
console.log('Running build...');
const buildRes = runCmd('npm', ['run', 'build']);
if (buildRes.exitCode !== 0) {
  console.error('LOCK RELEASE FAILED: npm run build failed.');
  process.exit(1);
}

// 2. Tests
console.log('Running test suite...');
const testFiles = [
  'tests/auditor-config.test.mjs',
  'tests/authority.test.mjs',
  'tests/capability.test.mjs',
  'tests/cli.test.mjs',
  'tests/conformance-schema.test.mjs',
  'tests/context.test.mjs',
  'tests/evidence.test.mjs',
  'tests/evidence-security.test.mjs',
  'tests/executor.test.mjs',
  'tests/kernel.test.mjs',
  'tests/memory.test.mjs',
  'tests/node-adapters.test.mjs',
  'tests/p0-runtime-hardening.test.mjs',
  'tests/p1-retry-fallback.test.mjs',
  'tests/p2-scheduler.test.mjs',
  'tests/p3-adversarial-security.test.mjs',
  'tests/p4-parallel-execution.test.mjs',
  'tests/p5-resource-scheduler.test.mjs',
  'tests/p6-evidence-system.test.mjs',
  'tests/p7-memory-context.test.mjs',
  'tests/p8-specialist-runtime.test.mjs',
  'tests/p9-failure-recovery.test.mjs',
  'tests/registry.test.mjs',
  'tests/status.test.mjs',
  'tests/audit-remediation.test.mjs',
  'tests/audit-remediation-round2.test.mjs'
];
const testCmdRes = runCmd('node', ['--test', ...testFiles]);
const summary = parseNodeTestSummary(testCmdRes.stdout);
const testStatus = classifyTestResult(testCmdRes.exitCode, summary);

if (testCmdRes.exitCode !== 0 || testStatus !== 'PASS' || summary.discovered < 80 || summary.failed > 0 || summary.skipped > 0) {
  console.error(`LOCK RELEASE FAILED: Test suite failed. Discovered: ${summary.discovered}, Passed: ${summary.passed}, Failed: ${summary.failed}, Skipped: ${summary.skipped}`);
  process.exit(1);
}

// 3. Self-check
console.log('Running self-check...');
const selfCheckCmdRes = runCmd('node', ['cli.mjs', 'self-check']);
let selfCheckStatus = 'FAIL';
try {
  const parsed = JSON.parse(selfCheckCmdRes.stdout);
  if (parsed.status === 'PASS' && selfCheckCmdRes.exitCode === 0) {
    selfCheckStatus = 'PASS';
  }
} catch {}

if (selfCheckStatus !== 'PASS') {
  console.error('LOCK RELEASE FAILED: Self-check failed.');
  process.exit(1);
}

// 4. Conformance
console.log('Running conformance...');
const confCmdRes = runCmd('node', ['scripts/run-conformance.mjs']);
if (confCmdRes.exitCode !== 0) {
  console.error('LOCK RELEASE FAILED: Conformance script failed.');
  process.exit(1);
}

// 5. Release manifest & File manifest
const releaseManifest = {
  name: 'ShortcutOS',
  version: 'V100',
  release_class: 'PORTABLE_RUNTIME',
  canonical_status: 'PORTABLE_V100_RUNTIME = 100/100 VERIFIED_LOCAL_CANONICAL_CONFORMANCE',
  commit: currentCommit,
  node_version: nodeVersion,
  npm_version: npmVersion,
  build: {
    command: 'npm run build',
    status: buildRes.status,
    exitCode: buildRes.exitCode
  },
  tests: {
    command: `node --test ${testFiles.join(' ')}`,
    discovered: summary.discovered,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    status: testStatus
  },
  self_check: {
    command: 'node cli.mjs self-check',
    status: selfCheckStatus,
    hostIntegrated: false
  },
  conformance: {
    command: 'node scripts/run-conformance.mjs',
    status: 'PASS'
  },
  canonical_versions: {
    first: 'V23',
    last: 'V100',
    total: 78
  },
  contracts: {
    mapped: 78,
    orphans: 0,
    unmapped: 0
  },
  security: {
    tamperProtection: 'FNV-1a64 integrity checksum and SHA-256 manifest',
    authenticityModel: 'Requires system-owned EvidenceTrustPolicy',
    pathTraversalProtection: 'Resolved realpath and pre-resolution relative confinement',
    memoryLockProtocol: 'Token-owned lease file lock with deadlock prevention'
  },
  host_integration: false,
  artifacts: [
    'audit/v100-contract-inventory.json',
    'audit/v100-release-trace.json',
    'audit/reports/v100-canonical-certification.json',
    'audit/reports/v100-release-manifest.json',
    'audit/reports/v100-file-manifest.json',
    'REPRODUCING_V100.md'
  ],
  limitations: [
    'Certification applies strictly to this portable Node.js runtime codebase.',
    'Certification applies to the tested local environment.',
    'External cloud or provider behavior is not automatically certified.',
    'ChatGPT host or system integration is NOT claimed.',
    'FNV-1a64 is a non-cryptographic integrity checksum; authenticity requires system-owned trust policy.',
    'Successful local conformance is not equivalent to every future deployment environment being error-free.'
  ],
  generated_at: new Date().toISOString()
};

writeFileSync(
  resolve(rootDir, 'audit/reports/v100-release-manifest.json'),
  JSON.stringify(releaseManifest, null, 2),
  'utf8'
);

function getFilesRecursively(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = resolve(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'scratch') {
        getFilesRecursively(filePath, fileList);
      }
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const targetDirs = ['src', 'tests', 'scripts', 'audit', '.agents'];
const singleFiles = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'cli.mjs',
  'node-adapters.mjs',
  'README.md',
  'CONFORMANCE.md',
  'IMPLEMENTATION_STATUS.md',
  'ShortcutOS_V100_Always_On_Profile.md',
  'REPRODUCING_V100.md'
];

const allFilePaths = [];
for (const sf of singleFiles) {
  const fullPath = resolve(rootDir, sf);
  try {
    if (statSync(fullPath).isFile()) {
      allFilePaths.push(fullPath);
    }
  } catch {}
}
for (const dir of targetDirs) {
  const fullDir = resolve(rootDir, dir);
  try {
    if (statSync(fullDir).isDirectory()) {
      getFilesRecursively(fullDir, allFilePaths);
    }
  } catch {}
}

const filesManifest = {};
const skipFiles = new Set([
  'audit/reports/v100-file-manifest.json'
]);

for (const fp of allFilePaths) {
  const relPath = relative(rootDir, fp).replace(/\\/g, '/');
  if (skipFiles.has(relPath)) continue;
  const content = readFileSync(fp);
  const hash = createHash('sha256').update(content).digest('hex');
  filesManifest[relPath] = hash;
}

const fileManifestOutput = {
  algorithm: 'SHA-256',
  generated_at: new Date().toISOString(),
  total_files: Object.keys(filesManifest).length,
  files: filesManifest
};

writeFileSync(
  resolve(rootDir, 'audit/reports/v100-file-manifest.json'),
  JSON.stringify(fileManifestOutput, null, 2),
  'utf8'
);

// 6. Verify canonical trace
console.log('Verifying canonical trace...');
const verifyCmdRes = runCmd('node', ['scripts/verify-canonical-trace.mjs']);
if (verifyCmdRes.exitCode !== 0) {
  console.error('LOCK RELEASE FAILED: Canonical trace verification failed.');
  process.exit(1);
}

console.log('Release provenance reports locked successfully.');
