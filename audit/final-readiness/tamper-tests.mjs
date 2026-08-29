import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

console.log('=== RUNNING PROVENANCE TAMPER TESTS 1-9 ===');

const rootDir = process.cwd();
const tamperDir = join(tmpdir(), 'shortcutos-tamper-tests-' + Date.now());
mkdirSync(tamperDir, { recursive: true });

function copyDir(src, dest) {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const child of readdirSync(src)) {
      if (child === '.git' || child === 'node_modules') continue;
      copyDir(join(src, child), join(dest, child));
    }
  } else {
    copyFileSync(src, dest);
  }
}

function copyWorkspace(dest) {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  execFileSync('git', ['clone', rootDir, dest], { stdio: 'ignore' });
  const items = ['scripts', 'src', 'tests', 'audit', 'shortcutos-v100-runtime-final.release.json', 'shortcutos-v100-runtime-final.zip'];
  for (const item of items) {
    const srcPath = join(rootDir, item);
    const destPath = join(dest, item);
    if (existsSync(srcPath)) copyDir(srcPath, destPath);
  }
}

const tamperResults = [];

function runTamperTest(num, description, tamperFn) {
  const testPath = join(tamperDir, `test-${num}`);
  copyWorkspace(testPath);
  tamperFn(testPath);

  const res = spawnSync(process.execPath, ['scripts/verify-canonical-trace.mjs'], {
    cwd: testPath,
    encoding: 'utf8'
  });

  const failedClosed = res.status !== 0 || res.stdout.includes('FAIL') || res.stdout.includes('NOT_100');
  if (failedClosed) {
    console.log(`[PASS] Tamper Test ${num}: ${description} -> Correctly rejected`);
    tamperResults.push({ num, description, status: 'PASS' });
  } else {
    console.error(`[FAIL] Tamper Test ${num}: ${description} -> UNEXPECTEDLY ACCEPTED`);
    tamperResults.push({ num, description, status: 'FAIL' });
  }
  rmSync(testPath, { recursive: true, force: true });
}

// 1. Modify external receipt commit
runTamperTest(1, 'Modify external receipt commit', (p) => {
  const receiptPath = join(p, 'shortcutos-v100-runtime-final.release.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.commit = '0000000000000000000000000000000000000000';
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
});

// 2. Modify external receipt ZIP hash
runTamperTest(2, 'Modify external receipt ZIP hash', (p) => {
  const receiptPath = join(p, 'shortcutos-v100-runtime-final.release.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.release_zip.sha256 = '0000000000000000000000000000000000000000000000000000000000000000';
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
});

// 3. Modify release manifest commit
runTamperTest(3, 'Modify release manifest / file-manifest', (p) => {
  const manifestPath = existsSync(join(p, 'audit/final-readiness/file-manifest.json'))
    ? join(p, 'audit/final-readiness/file-manifest.json')
    : join(p, 'audit/reports/v100-file-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.commit = '1111111111111111111111111111111111111111';
  manifest.files['src/kernel.ts'] = '0000000000000000000000000000000000000000000000000000000000000000';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
});

// 4. Modify canonical trace status
runTamperTest(4, 'Modify canonical trace status', (p) => {
  const certPath = join(p, 'audit/final-readiness/v100-canonical-certification.json');
  if (existsSync(certPath)) {
    const cert = JSON.parse(readFileSync(certPath, 'utf8'));
    cert.canonicalScore = 50;
    cert.verified = false;
    writeFileSync(certPath, JSON.stringify(cert, null, 2));
  } else {
    // If not present, modify src/status.ts to fail build/test
    writeFileSync(join(p, 'src/status.ts'), 'export const tampered = true;');
  }
});

// 5. Remove one mapped source file
runTamperTest(5, 'Remove one mapped source file', (p) => {
  const src = join(p, 'src/kernel.ts');
  if (existsSync(src)) rmSync(src);
});

// 6. Remove one mapped test file
runTamperTest(6, 'Remove one mapped test file', (p) => {
  const testFile = join(p, 'tests/kernel.test.mjs');
  if (existsSync(testFile)) rmSync(testFile);
});

// 7. Add stale internal receipt with old commit/hash
runTamperTest(7, 'Add stale internal receipt with old commit/hash', (p) => {
  const stalePath = join(p, 'audit/reports/stale-test-receipt.json');
  mkdirSync(join(p, 'audit/reports'), { recursive: true });
  writeFileSync(stalePath, JSON.stringify({
    version: 'V100',
    tag: 'shortcutos-v100.0.0',
    commit: '0000000000000000000000000000000000000000',
    release_zip: {
      filename: 'shortcutos-v100-runtime-final.zip',
      size_bytes: 999999,
      sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    },
    verdict: 'FROZEN_VERIFIED_LOCAL_CANONICAL_RELEASE'
  }, null, 2));
});

// 8. Change tag to foreign commit
runTamperTest(8, 'Change tag to foreign commit', (p) => {
  execFileSync('git', ['tag', '-f', 'shortcutos-v100.0.0', 'HEAD~1'], { cwd: p, stdio: 'ignore' });
});

// 9. Change HEAD while keeping receipt unchanged
runTamperTest(9, 'Change HEAD while keeping receipt unchanged', (p) => {
  writeFileSync(join(p, 'tamper.txt'), 'tamper');
  execFileSync('git', ['add', '-A'], { cwd: p, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'foreign-commit'], { cwd: p, stdio: 'ignore' });
});

rmSync(tamperDir, { recursive: true, force: true });

console.log('\n=== PROVENANCE TAMPER TESTS SUMMARY ===');
const allTamperPassed = tamperResults.every(t => t.status === 'PASS');
console.log(`Total tamper tests: ${tamperResults.length}, Passed: ${tamperResults.filter(t => t.status === 'PASS').length}, Failed: ${tamperResults.filter(t => t.status === 'FAIL').length}`);
if (!allTamperPassed) {
  process.exit(1);
}
