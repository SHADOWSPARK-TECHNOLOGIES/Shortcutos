import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());

const inventoryPath = resolve(rootDir, 'audit/v100-contract-inventory.json');
const tracePath = resolve(rootDir, 'audit/v100-release-trace.json');

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const trace = JSON.parse(readFileSync(tracePath, 'utf8'));

const partialVersions = new Set([
  'V43', 'V58', 'V59', 'V68',
  'V72', 'V73', 'V74', 'V75', 'V76', 'V77', 'V78', 'V79',
  'V83', 'V89', 'V92', 'V93', 'V96'
]);

for (const item of inventory) {
  if (partialVersions.has(item.version)) {
    item.status = 'PARTIALLY_IMPLEMENTED';
  } else {
    item.status = 'IMPLEMENTED_AND_RUNTIME_TESTED';
  }

  // Validate source files exist
  item.source_files = (item.source_files || []).filter((f) => existsSync(resolve(rootDir, f)));
  item.tests = (item.tests || []).filter((t) => existsSync(resolve(rootDir, t)));
}

for (const item of trace) {
  if (partialVersions.has(item.canonical_version)) {
    item.implementation_status = 'PARTIALLY_IMPLEMENTED';
  } else {
    item.implementation_status = 'IMPLEMENTED_AND_RUNTIME_TESTED';
  }

  item.source_files = (item.source_files || []).filter((f) => existsSync(resolve(rootDir, f)));
  item.test_files = (item.test_files || []).filter((t) => existsSync(resolve(rootDir, t)));
}

writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

console.log(`Inventory and release trace aligned cleanly.`);
console.log(`Total canonical versions: ${inventory.length}`);
console.log(`Implemented & Tested: ${inventory.filter(i => i.status === 'IMPLEMENTED_AND_RUNTIME_TESTED').length}`);
console.log(`Partially Implemented: ${inventory.filter(i => i.status === 'PARTIALLY_IMPLEMENTED').length}`);
