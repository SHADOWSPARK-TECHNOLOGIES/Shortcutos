import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const rootDir = resolve(process.cwd());

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
  'tsconfig.json',
  'cli.mjs',
  'node-adapters.mjs',
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
  } catch {
    // skip if optional file doesn't exist
  }
}

for (const dir of targetDirs) {
  const fullDir = resolve(rootDir, dir);
  try {
    if (statSync(fullDir).isDirectory()) {
      getFilesRecursively(fullDir, allFilePaths);
    }
  } catch {
    // skip if optional dir doesn't exist
  }
}

const filesManifest = {};

for (const fp of allFilePaths) {
  const relPath = relative(rootDir, fp).replace(/\\/g, '/');
  // Skip v100-file-manifest.json itself if present
  if (relPath === 'audit/reports/v100-file-manifest.json') continue;

  const content = readFileSync(fp);
  const hash = createHash('sha256').update(content).digest('hex');
  filesManifest[relPath] = hash;
}

const manifestOutput = {
  algorithm: 'SHA-256',
  generated_at: new Date().toISOString(),
  total_files: Object.keys(filesManifest).length,
  files: filesManifest
};

const outputPath = resolve(rootDir, 'audit/reports/v100-file-manifest.json');
writeFileSync(outputPath, JSON.stringify(manifestOutput, null, 2), 'utf8');

console.log(`Generated SHA-256 file manifest for ${manifestOutput.total_files} files at ${outputPath}`);
