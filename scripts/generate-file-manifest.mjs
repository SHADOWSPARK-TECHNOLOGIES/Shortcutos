import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

const rootDir = resolve(process.cwd());

const skipFiles = new Set([
  'audit/reports/v100-file-manifest.json',
  'audit/reports/v100-canonical-certification.json',
  'audit/reports/v100-release-manifest.json',
  'shortcutos-v100-runtime-final.release.json',
  'shortcutos-v100-runtime-final.zip'
]);

const skipDirs = new Set(['.git', 'node_modules', 'dist']);

function walk(dir) {
  const files = [];
  for (const item of readdirSync(dir)) {
    const fullPath = resolve(dir, item);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (!skipDirs.has(item)) {
        files.push(...walk(fullPath));
      }
    } else {
      if (!skipFiles.has(relPath)) {
        files.push(relPath);
      }
    }
  }
  return files;
}

const fileList = walk(rootDir).sort();
const manifest = {
  version: 'V100',
  generatedAt: new Date().toISOString(),
  files: {}
};

for (const relPath of fileList) {
  if (relPath.startsWith('audit/reports/conformance-')) continue;
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
