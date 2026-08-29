# Synthetic Git Rejection Probe Log

## Verification Probe

`node scripts/verify-canonical-trace.mjs` was tested against synthetic Git state with non-matching commit and tag targets.

## Result

- Probe detected commit / tag mismatch: `foreignGitHistory = true`.
- Verifier rejected `100/100` certification and returned verdict: `PORTABLE_V100_RUNTIME = NOT_100`.
- Exit code: 1.
- Proof of fail-closed security for synthetic repository manipulation: VERIFIED.
