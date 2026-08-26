# ShortcutOS V100 Runtime Kernel

A portable, dependency-free TypeScript conformance kernel for the ShortcutOS V100 user-level operating framework.

## What this implements

- canonical authority ordering;
- evidence-honest verification state transitions;
- source-present ≠ claim-verified behavior;
- stale/conflicting context visibility;
- append-history persistent memory with correction and tombstone semantics;
- verification-before-completion lifecycle rules;
- structured ShortcutOS errors;
- a root-confined real local file-read adapter;
- a local self-check CLI.

## What this does **not** claim

This package does not modify ChatGPT host/system instructions, install itself into the model, create unavailable tools, or make external runtime capabilities appear. It is a portable kernel that can be used by Codex, Node.js applications, agents, or local automation runtimes.

## Requirements

- Node.js 22+
- TypeScript 5.8+ available as `tsc`

No npm dependencies are required for the core runtime. Node-specific persistence and local file adapters use only built-in Node.js modules.

## Build and test

```bash
npm run build
npm test
```

## Self-check

```bash
node cli.mjs self-check
```

Expected result includes:

```json
{
  "status": "PASS",
  "runtimeKernel": "VERIFIED_BY_LOCAL_TESTS",
  "hostIntegrated": false
}
```

`hostIntegrated: false` is intentional and honest: platform-level integration is outside the authority of this package.


## Deterministic V100 conformance auditor

The repository includes a workspace-local conformance auditor whose primitive build, test, and self-check facts come from a deterministic Node.js runner rather than an AI reviewer.

Run it with:

```bash
npm run audit:conformance
```

Write evidence to an explicit path with:

```bash
npm run audit:conformance -- --output audit/reports/manual.json
```

Generated `audit/reports/*.json` files are ignored by Git. The runner enforces `exit code 0 + zero discovered tests != PASS` and continues capturing evidence after build, test, or self-check failures.

### Antigravity workspace reviewer

This repository also carries a read-oriented Antigravity custom agent and conformance skill under `.agents/`. From the repository root:

```text
agy
/agents
select shortcutos-auditor
```

The Antigravity reviewer may inspect source, run the deterministic conformance command, and produce a schema-constrained review. It is not the conformance authority: primitive machine evidence remains separate from generative analysis, and the human release gate remains final.

The strict review contract is `audit/schemas/conformance-report.schema.json`; the canonical invariant questions are `audit/fixtures/expected-invariants.json`.

**Boundary:** local conformance tooling is implemented in this repository. Passing the local suite does not prove the entire ShortcutOS V100 specification is runtime-conformant.

## Profile

```bash
node cli.mjs profile
```

## Core API

```ts
import {
  ShortcutOSKernel,
  AuthorityLevel,
  canOverride,
  assembleContext,
  verifyClaim
} from './dist/index.js';
```

The kernel remains deliberately modular. Persistent memory and Node-local adapters are implemented as explicit conformance layers; external provider connectors, specialist modules, retry/fallback engines, and scheduler implementations remain separate future layers.

## Current verified execution boundary

The package now includes:

- `CanonicalRegistry`
- `CapabilityResolver`
- `ToolAdapterRegistry`
- `createDispatch()`
- `executeOnce()`

`executeOnce()` performs at most one adapter invocation. It does not retry, fall back, or silently rebind providers. An unavailable or capability-mismatched adapter remains blocked.

See `IMPLEMENTATION_STATUS.md` for the exact implemented/not-implemented boundary.

## Persistent memory

```js
import { ContextFreshness, MemoryRepository } from './dist/index.js';
import { createNodeMemoryTextStore } from './node-adapters.mjs';

const memory = new MemoryRepository(createNodeMemoryTextStore('./state/memory.json'));
await memory.put({
  eventId: 'event-1',
  record: {
    id: 'memory-1',
    key: 'project.mode',
    value: 'strict',
    freshness: ContextFreshness.FRESH,
    priority: 10,
    provenance: { kind: 'user', ref: 'conversation-turn' }
  }
});
```

Memory corrections append a supersession event rather than erasing history. Tombstoned records remain in the journal but are excluded from active context assembly.

## Local file adapter

```js
import { ToolAdapterRegistry, createDispatch, executeOnce } from './dist/index.js';
import { createLocalFileReadAdapter } from './node-adapters.mjs';

const adapters = new ToolAdapterRegistry();
adapters.register(createLocalFileReadAdapter({ id: 'node.file.read', root: process.cwd() }));
const dispatch = createDispatch({
  id: 'read-1',
  capability: 'file.read',
  adapterId: 'node.file.read',
  input: { path: 'README.md' }
}, adapters);
const result = await executeOnce(dispatch, adapters);
```

The adapter resolves real paths and rejects traversal or symlink escape outside the configured root.
