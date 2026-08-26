#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdapterAvailability,
  AuthorityLevel,
  canOverride,
  CanonicalRegistry,
  CapabilityAvailability,
  CapabilityBindingStatus,
  CapabilityResolver,
  ClaimVerificationStatus,
  ContextFreshness,
  createDispatch,
  EvidenceStatus,
  MemoryRepository,
  ExecutionResultStatus,
  executeOnce,
  ToolAdapterRegistry,
  verifyClaim,
  assembleContext
} from './dist/index.js';
import { createLocalFileReadAdapter, createNodeMemoryTextStore } from './node-adapters.mjs';

const command = process.argv[2] ?? 'self-check';

if (command === 'self-check') {
  const authorityOk =
    canOverride(AuthorityLevel.SYSTEM, AuthorityLevel.SHORTCUTOS) === true &&
    canOverride(AuthorityLevel.SHORTCUTOS, AuthorityLevel.USER) === false;

  const claim = verifyClaim('self-check-claim', [
    { id: 'source-only', status: EvidenceStatus.SOURCE_PRESENT }
  ]);
  const evidenceOk = claim.status === ClaimVerificationStatus.UNVERIFIED;

  const context = assembleContext([
    { id: 'fresh', key: 'mode', value: 'safe', freshness: ContextFreshness.FRESH, priority: 2 },
    { id: 'stale', key: 'history', value: 'old', freshness: ContextFreshness.STALE, priority: 1 }
  ]);
  const contextOk = context.hasStaleState === true;

  const registry = new CanonicalRegistry();
  registry.register({ id: 'quality.verify' });
  registry.registerAlias('verify', 'quality.verify');
  const registryOk = registry.get('verify')?.id === 'quality.verify';

  const capability = new CapabilityResolver([
    {
      providerId: 'local-echo',
      capability: 'demo.echo',
      availability: CapabilityAvailability.AVAILABLE
    },
    {
      providerId: 'unknown-writer',
      capability: 'file.write',
      availability: CapabilityAvailability.UNKNOWN
    }
  ]);
  const capabilityOk =
    capability.resolve('demo.echo').status === CapabilityBindingStatus.BOUND &&
    capability.resolve('file.write').status === CapabilityBindingStatus.UNKNOWN;

  let invocationCount = 0;
  const adapters = new ToolAdapterRegistry();
  adapters.register({
    id: 'local-echo',
    capability: 'demo.echo',
    availability: AdapterAvailability.AVAILABLE,
    async invoke(input) {
      invocationCount += 1;
      return {
        status: ExecutionResultStatus.SUCCEEDED,
        output: input,
        evidence: [{ kind: 'self-check', ref: 'local-echo-1' }]
      };
    }
  });
  const dispatch = createDispatch({
    id: 'self-check-dispatch',
    capability: 'demo.echo',
    adapterId: 'local-echo',
    input: { ok: true }
  }, adapters);
  const execution = await executeOnce(dispatch, adapters);
  const executionOk =
    execution.status === ExecutionResultStatus.SUCCEEDED &&
    invocationCount === 1 &&
    execution.evidence.length === 1;

  const tempRoot = await mkdtemp(join(tmpdir(), 'shortcutos-self-check-'));
  let persistentMemoryOk = false;
  let localFileReadAdapterOk = false;
  try {
    const memoryPath = join(tempRoot, 'memory.json');
    const firstMemory = new MemoryRepository(createNodeMemoryTextStore(memoryPath));
    await firstMemory.put({
      eventId: 'self-check-memory-event',
      record: {
        id: 'self-check-memory',
        key: 'self-check.mode',
        value: 'persistent',
        freshness: ContextFreshness.FRESH,
        priority: 1,
        provenance: { kind: 'self-check', ref: 'memory-1' }
      }
    });
    const secondMemory = new MemoryRepository(createNodeMemoryTextStore(memoryPath));
    persistentMemoryOk = (await secondMemory.records())[0]?.value === 'persistent';

    await writeFile(join(tempRoot, 'self-check.txt'), 'shortcutos', 'utf8');
    const localAdapters = new ToolAdapterRegistry();
    localAdapters.register(createLocalFileReadAdapter({ id: 'node.file.read', root: tempRoot }));
    const fileDispatch = createDispatch({
      id: 'self-check-file-dispatch',
      capability: 'file.read',
      adapterId: 'node.file.read',
      input: { path: 'self-check.txt' }
    }, localAdapters);
    const fileExecution = await executeOnce(fileDispatch, localAdapters);
    localFileReadAdapterOk =
      fileExecution.status === ExecutionResultStatus.SUCCEEDED &&
      fileExecution.output?.text === 'shortcutos' &&
      fileExecution.evidence.length === 1;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  const passed = authorityOk && evidenceOk && contextOk && registryOk && capabilityOk && executionOk && persistentMemoryOk && localFileReadAdapterOk;
  process.stdout.write(JSON.stringify({
    status: passed ? 'PASS' : 'FAIL',
    runtimeKernel: passed ? 'VERIFIED_BY_LOCAL_TESTS' : 'FAILED',
    hostIntegrated: false,
    checks: {
      authorityHierarchy: authorityOk,
      evidenceHonesty: evidenceOk,
      staleContextVisibility: contextOk,
      canonicalRegistry: registryOk,
      capabilityHonesty: capabilityOk,
      singleAttemptExecution: executionOk,
      persistentMemory: persistentMemoryOk,
      localFileReadAdapter: localFileReadAdapterOk
    }
  }, null, 2) + '\n');
  process.exitCode = passed ? 0 : 1;
} else if (command === 'profile') {
  process.stdout.write(JSON.stringify({
    version: 'V100',
    mode: 'user-level operating framework',
    hostIntegrated: false,
    invariants: [
      'No fabricated runtime/tool/capability/test claims',
      'UNKNOWN stays UNKNOWN',
      'Planning, routing, dispatch, execution, verification, and completion remain distinct',
      'Evidence before claims',
      'Stale/conflicting context remains explicit',
      'Verification before completion'
    ]
  }, null, 2) + '\n');
} else {
  process.stderr.write(`Unknown command: ${command}\n`);
  process.exitCode = 2;
}
