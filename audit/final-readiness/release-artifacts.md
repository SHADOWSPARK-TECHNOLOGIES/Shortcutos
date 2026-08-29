# Release Artifacts

ZIP: shortcutos-v100-runtime-final.zip
ZIP size: 421556 bytes
ZIP sha256: 6b88d711d9b379469e2decfdc4844d4b6d587fe680c97f00adf9f3c2eb3302fb
External receipt: shortcutos-v100-runtime-final.release.json
Receipt commit: 2cf88429999cdf2d25b86fb7724f3583c0dd2f7b
Receipt tag_commit: 2cf88429999cdf2d25b86fb7724f3583c0dd2f7b
Receipt head_equals_tag: true
Internal stale receipts present in ZIP: none
Internal/external provenance contradictions: none

## Artifact Verification

```bash
Get-FileHash .\shortcutos-v100-runtime-final.zip -Algorithm SHA256
Algorithm       Hash                                                             Path
---------       ----                                                             ----
SHA256          6B88D711D9B379469E2DECFDC4844D4B6D587FE680C97F00ADF9F3C2EB3302FB C:\Users\wonde\.gemini\antigravity\scratch\shortcutos-v100-runtime\shortcutos-v100-runtime-final.zip

node scripts/verify-canonical-trace.mjs
Canonical trace certification complete. Final verdict: PORTABLE_V100_RUNTIME = 100/100 VERIFIED_LOCAL_CANONICAL_CONFORMANCE
```
