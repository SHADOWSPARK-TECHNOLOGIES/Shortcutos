# Codex Bootstrap — ShortcutOS V100 Runtime

You are implementing the ShortcutOS V100 conformance runtime.

Start by reading:

1. `README.md`
2. `CONFORMANCE.md`
3. `docs/superpowers/plans/2026-08-26-shortcutos-v100-conformance.md`
4. the user-level canonical profile supplied alongside this package: `ShortcutOS_V100_Always_On_Profile.md` if copied into the workspace

Current verified local slice:

- authority hierarchy
- design/runtime verification distinction
- evidence-honest claim status
- stale/conflicting context visibility
- verification-before-completion kernel
- self-check CLI

Mandatory engineering rules:

- use test-first development for every new behavior;
- run the failing test before production code;
- never fabricate provider/tool/runtime capabilities;
- never mark runtime behavior verified without actual test/execution evidence;
- UNKNOWN stays UNKNOWN;
- keep planning, routing, dispatch, execution, verification, and completion separate;
- preserve provenance and freshness;
- keep external adapters outside the core kernel;
- run the full regression suite before completion claims.

Next implementation band:

1. typed command/module/capability registries;
2. adapter interface for real tools/providers;
3. dispatch/execution contracts;
4. bounded retry/fallback controller;
5. persistent context adapter with stale/conflict semantics;
6. evidence/provenance store adapter;
7. conformance suites mapped to V23–V100 bands.

Do not build all features into one file. Keep modules small and testable.


## Verified Node-local adapters

- `createNodeMemoryTextStore(path)` — atomic JSON journal persistence.
- `createLocalFileReadAdapter({ id, root })` — real root-confined local file reads.

Use these adapters explicitly; do not infer external provider availability from their existence.
