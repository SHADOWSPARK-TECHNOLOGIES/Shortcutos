# ShortcutOS V100 Runtime — Implementation Status

## Verified local conformance slice

The following behavior is implemented and covered by local executable tests:

- authority hierarchy protects system/developer/tool/user authority from ShortcutOS override;
- runtime verification cannot be claimed without evidence;
- design verification remains distinct from runtime verification;
- source presence does not imply claim verification;
- contradictory evidence remains explicit;
- stale context remains explicit;
- conflicting context is surfaced rather than silently merged;
- canonical registries reject duplicate IDs and alias chains;
- capability UNKNOWN/UNAVAILABLE states never become invented bindings;
- adapter availability is explicit;
- capability mismatches block dispatch;
- unavailable adapters are not invoked;
- available adapters execute exactly once;
- invocation failure is recorded without automatic retry;
- completion requires verified acceptance evidence;
- append-history memory persists through a fresh repository instance;
- corrections supersede records without deleting history;
- tombstoned memory remains auditable but is excluded from active context;
- Node persistence writes memory atomically;
- a real local `file.read` adapter performs root-confined reads and blocks traversal;
- the self-check explicitly reports `hostIntegrated: false`.
- the deterministic conformance runner captures repository, environment, build, test, and self-check evidence;
- zero discovered tests are classified as `INVALID_ZERO_TESTS` even when the test command exits zero;
- the strict final-review schema rejects unknown top-level fields and invalid conformance classifications;
- the repository-local Antigravity auditor is constrained to read/search/command tools and treats deterministic evidence as the primitive source of runtime facts;
- bounded retry & controlled fallback execution controller handles transient failures and immutable attempt tracking;
- sequential workflow scheduler resolves DAG step dependencies and handles step failure/skip/unknown status propagation;
- FNV-1a64 evidence envelope hashing and integrity verification reject tampered evidence envelopes;
- path traversal protection checks relative requested paths both pre- and post-realpath resolution;
- memory repository enforces version-based optimistic concurrency control.

## Not yet implemented

These are future runtime layers, not falsely claimed as complete:

- real external provider/tool connectors beyond the verified local file-read adapter;
- platform/host-level ChatGPT integration.

## Integration model

There are two distinct layers:

1. **ChatGPT user-level behavior:** the ShortcutOS V100 operating profile is saved as user memory and used as a default convention for relevant work.
2. **Portable executable kernel:** this repository can be run under Node.js/Codex and proves local conformance behaviors through tests.

Neither layer claims authority to rewrite ChatGPT host/system/developer instructions.

## Conformance tooling boundary

The conformance tooling verifies and reports the implemented local runtime slice. It does **not** convert the whole V23–V100 specification into `RUNTIME_VERIFIED`. The raw primitive report and any Antigravity/LLM review remain separate artifacts, and a human release decision is still required.
