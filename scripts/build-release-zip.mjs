import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const zipPath = resolve(rootDir, 'shortcutos-v100-runtime-final.zip');

const filesToInclude = [
  'src',
  'tests',
  'scripts',
  'audit',
  '.agents',
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
].filter(f => existsSync(resolve(rootDir, f)));

console.log('Creating release ZIP archive via PowerShell Compress-Archive...');
const psCommand = `Compress-Archive -Path ${filesToInclude.map(f => `'${f}'`).join(',')} -DestinationPath '${zipPath}' -Force`;

execFileSync('powershell', ['-Command', psCommand], { encoding: 'utf8' });

const zipContent = readFileSync(zipPath);
const zipSha256 = createHash('sha256').update(zipContent).digest('hex');

console.log(`Release bundle created: ${zipPath}`);
console.log(`Release bundle size: ${zipContent.length} bytes`);
console.log(`Release bundle SHA-256: ${zipSha256}`);
