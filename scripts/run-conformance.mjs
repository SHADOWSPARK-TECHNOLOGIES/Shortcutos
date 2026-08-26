#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runPrimitiveConformance } from './conformance-lib.mjs';

function resolveRepositoryRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8'
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`CONFORMANCE_REPOSITORY_ROOT_UNAVAILABLE: ${message}`);
  }
}

function parseArgs(argv) {
  let output = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('CONFORMANCE_OUTPUT_PATH_REQUIRED');
      }
      output = value;
      i += 1;
      continue;
    }
    throw new Error(`CONFORMANCE_UNKNOWN_ARGUMENT: ${arg}`);
  }
  return { output };
}

function defaultOutputPath(root) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(root, 'audit', 'reports', `conformance-${stamp}.json`);
}

function isPrimitivePass(report) {
  return report.build.exitCode === 0
    && report.tests.status === 'PASS'
    && report.selfCheck.status === 'PASS';
}

function main() {
  const { output } = parseArgs(process.argv.slice(2));
  const root = resolveRepositoryRoot(process.cwd());
  const report = runPrimitiveConformance({ root });
  const outputPath = output ? resolve(process.cwd(), output) : defaultOutputPath(root);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const primitiveStatus = isPrimitivePass(report) ? 'PASS' : 'FAIL';
  process.stdout.write(
    `ShortcutOS primitive conformance ${primitiveStatus}: ${outputPath} `
    + `(tests=${report.tests.discovered}, testStatus=${report.tests.status}, selfCheck=${report.selfCheck.status})\n`
  );
  process.exitCode = primitiveStatus === 'PASS' ? 0 : 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}
