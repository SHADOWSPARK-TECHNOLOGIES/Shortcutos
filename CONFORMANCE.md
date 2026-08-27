# ShortcutOS V100 Conformance Matrix

| V100 invariant / component | Implemented | Locally runtime-tested |
|---|---:|---:|
| Authority ordering | Yes | Yes |
| Runtime verification requires evidence | Yes | Yes |
| Planning/execution/verification separation | Yes | Yes |
| Source presence ≠ claim verification | Yes | Yes |
| Contradictory evidence remains explicit | Yes | Yes |
| Stale context remains explicit | Yes | Yes |
| Conflicting context is surfaced | Yes | Yes |
| Canonical registry duplicate protection | Yes | Yes |
| Direct alias / no alias chains | Yes | Yes |
| Capability availability honesty | Yes | Yes |
| Missing capability is not invented | Yes | Yes |
| Adapter availability contract | Yes | Yes |
| Capability mismatch blocks dispatch | Yes | Yes |
| Single-attempt execution | Yes | Yes |
| Invocation failure does not auto-retry | Yes | Yes |
| Evidence-bearing execution envelope | Yes | Yes |
| Verification-before-completion kernel | Yes | Yes |
| Structured ShortcutError contract | Yes | Build-verified |
| Persistent context/memory store | Yes | Yes |
| Root-confined real local file adapter | Yes | Yes |
| Deterministic primitive conformance runner | Yes | Yes |
| Zero-test invalidation rule | Yes | Yes |
| Strict final-report schema/validator | Yes | Yes |
| Workspace-local Antigravity auditor configuration | Yes | Repository-tested |
| Real external provider adapters | No | Not implemented |
| Retry/fallback runtime controller | Yes | Yes |
| Sequential/DAG workflow scheduler runtime | Yes | Yes |
| Evidence integrity & path traversal security hardening | Yes | Yes |
| Memory concurrency conflict protection | Yes | Yes |
| ChatGPT host/system integration | Not possible from package | No claim |

`Locally runtime-tested` refers only to this Node.js package. It does not imply external provider, account, or ChatGPT host integration.
