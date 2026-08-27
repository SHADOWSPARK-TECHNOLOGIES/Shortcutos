import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

const rootDir = resolve(process.cwd());

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

function getFilesRecursively(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = resolve(dir, file);
    if (statSync(filePath).isDirectory()) {
      getFilesRecursively(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

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

const skipFiles = new Set([
  'audit/reports/v100-file-manifest.json',
  'audit/reports/v100-canonical-certification.json',
  'audit/reports/v100-release-manifest.json',
  'shortcutos-v100-runtime-final.release.json',
  'shortcutos-v100-runtime-final.zip'
]);

const fileList = [];
for (const fp of allFilePaths) {
  const relPath = relative(rootDir, fp).replace(/\\/g, '/');
  if (skipFiles.has(relPath) || relPath.startsWith('audit/reports/conformance-')) continue;
  fileList.push(relPath);
}
fileList.sort();

const manifest = {
  version: 'V100',
  generatedAt: new Date().toISOString(),
  files: {}
};

for (const relPath of fileList) {
  const fullPath = resolve(rootDir, relPath);
  const isText = relPath.endsWith('.ts') || relPath.endsWith('.mjs') || relPath.endsWith('.json') || relPath.endsWith('.md') || relPath.endsWith('.txt');
  let hash = '';
  if (isText) {
    const text = readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
    hash = createHash('sha256').update(text, 'utf8').digest('hex');
  } else {
    const buf = readFileSync(fullPath);
    hash = createHash('sha256').update(buf).digest('hex');
  }
  manifest.files[relPath] = hash;
}

const outputPath = resolve(rootDir, 'audit/reports/v100-file-manifest.json');
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`File manifest generated: ${Object.keys(manifest.files).length} files written to audit/reports/v100-file-manifest.json`);
