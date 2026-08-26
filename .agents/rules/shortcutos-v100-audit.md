# ShortcutOS V100 Audit Rules

These rules apply to ShortcutOS conformance review.

## Non-negotiable rules

- No fabricated machine state.
- No numeric confidence or readiness score unless derived from an explicitly defined metric.
- No production writes during conformance review.
- No hidden retries.
- No silent provider or model rebinding.
- No unbounded concurrency.
- No full-V100 conformance claim from local subset tests.
- Every material finding must point to source, test, raw evidence, or be explicitly labeled as an unverified hypothesis.
- UNKNOWN remains UNKNOWN unless stronger evidence is produced.
- PARTIAL remains explicit.
- STALE remains explicit.

## Security and adversarial checklist

Inspect source or flag missing deterministic tests for:

- authority escalation;
- dispatch bypass;
- execution without dispatch;
- capability spoofing;
- adapter registry poisoning;
- alias and registry poisoning;
- evidence spoofing;
- UNKNOWN → SUCCESS coercion;
- PARTIAL → SUCCESS coercion;
- silent retry;
- silent provider rebinding;
- duplicate execution;
- idempotency violations;
- timeout ambiguity;
- AbortSignal behavior;
- unknown side effects;
- memory journal corruption;
- concurrent writer loss;
- stale-state reuse;
- conflict suppression;
- path traversal;
- symlink escape;
- TOCTOU races;
- oversized file reads;
- special-file reads;
- sensitive-path leakage.

A property without deterministic proof must be reported as `UNKNOWN`, `PARTIALLY_IMPLEMENTED`, `DESIGN_ONLY`, or `NOT_IMPLEMENTED` as appropriate. Never infer PASS from absence of a finding.
