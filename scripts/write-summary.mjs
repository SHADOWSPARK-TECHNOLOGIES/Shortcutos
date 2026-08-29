import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const evidenceDir = path.resolve('audit/final-readiness');
const zipPath = path.resolve('shortcutos-v100-runtime-final.zip');
const zipStat = fs.statSync(zipPath);
const zipHash = execSync('powershell -Command "(Get-FileHash shortcutos-v100-runtime-final.zip -Algorithm SHA256).Hash.ToLower()"', { encoding: 'utf8' }).trim();
const receipt = fs.readFileSync('shortcutos-v100-runtime-final.release.json', 'utf8');

const summary = `# ShortcutOS V100 Final GitHub Readiness Summary

Generated: ${new Date().toISOString()}
Repository: SHADOWSPARK-TECHNOLOGIES/Shortcutos
Project root: ${process.cwd()}

## Release artifact
- ZIP: shortcutos-v100-runtime-final.zip
- Size bytes: ${zipStat.size}
- SHA-256: ${zipHash}
- External receipt: shortcutos-v100-runtime-final.release.json

## Verification gates executed
- npm run build
- npm test
- node cli.mjs self-check
- npm run audit:conformance
- node scripts/verify-canonical-trace.mjs
- fresh standalone extracted-ZIP verification outside Git
- synthetic foreign Git rejection

## External receipt
\`\`\`json
${receipt}
\`\`\`
`;

fs.writeFileSync(path.join(evidenceDir, 'FINAL_READINESS_SUMMARY.md'), summary, 'utf8');
console.log('FINAL_READINESS_SUMMARY.md written successfully.');
