# Reproducing ShortcutOS V100 Canonical Release Certification

This document provides step-by-step instructions for any engineer to independently verify and reproduce the **ShortcutOS V100 Portable Runtime Canonical Certification** using only this repository.

---

## Environment Requirements

- **Node.js**: `v20.0.0` or higher (tested on Node.js `v24.19.0`)
- **npm**: `v9.0.0` or higher (tested on npm `11.17.0`)
- **OS**: Windows, macOS, or Linux

---

## Step-by-Step Reproduction Procedure

Execute the following commands sequentially from the repository root:

### 1. Build the TypeScript Codebase
```bash
npm run build
```
- **Expected Outcome**: `tsc -p tsconfig.json` compiles with `0` errors. The `dist/` directory is generated with updated ESM JavaScript outputs.

### 2. Execute Full Automated Test Suite
```bash
npm test
```
- **Expected Outcome**: Node test runner executes all unit, integration, and security test files under `tests/*.test.mjs`. All **83 subtests** must pass (`pass 83`, `fail 0`, `cancelled 0`).

### 3. Run Primitive CLI Self-Check
```bash
node cli.mjs self-check
```
- **Expected Outcome**: Outputs structured JSON with `"status": "PASS"` and `"hostIntegrated": false`. Returns exit code `0`.

### 4. Execute Conformance Audit Suite
```bash
npm run audit:conformance
```
- **Expected Outcome**: `scripts/run-conformance.mjs` executes clean build, test, and self-check passes, generating a dated report in `audit/reports/conformance-final-report.json` with `"status": "PASS"`.

### 5. Verify Canonical Release Trace Certification
```bash
node scripts/verify-canonical-trace.mjs
```
- **Expected Outcome**: Cross-verifies all 78 canonical versions (V23–V100) in `audit/v100-release-trace.json` against `audit/v100-contract-inventory.json`. Confirms `0` orphan contracts, `0` unmapped versions, and outputs:
  ```text
  Canonical trace certification complete. Final verdict: PORTABLE_V100_RUNTIME = 100/100 VERIFIED_LOCAL_CANONICAL_CONFORMANCE
  ```

---

## Summary of Verification Criteria

| Verification Gate | Expected Command | Success Criteria |
| :--- | :--- | :--- |
| **TypeScript Compiler** | `npm run build` | Exit code 0, 0 compiler errors |
| **Node Test Suite** | `npm test` | Exit code 0, 83/83 tests passing, 0 failures |
| **CLI Self-Check** | `node cli.mjs self-check` | Exit code 0, status `PASS`, `hostIntegrated: false` |
| **Conformance Audit** | `npm run audit:conformance` | Exit code 0, generates valid report in `audit/reports/` |
| **Canonical Trace** | `node scripts/verify-canonical-trace.mjs` | Exit code 0, 78/78 releases traced, verdict `100/100` |
