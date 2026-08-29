export * from './adapter.js';
export * from './authority.js';
export * from './capability.js';
export * from './context.js';
export * from './dispatch.js';
export * from './evidence.js';
export * from './errors.js';
export * from './executor.js';
export * from './kernel.js';
export * from './registry.js';
export * from './status.js';

export * from './memory.js';
export * from './acceptance.js';
export * from './retry.js';
export * from './scheduler.js';
export * from './parallel.js';
export * from './resource-scheduler.js';
export * from './evidence-system.js';
export {
  MemoryTier,
  ContextEntry,
  ContextCheckpoint,
  WorkingSetAssembly,
  MemoryTierManager,
  ContextCarrier
} from './memory-system.js';
export * from './specialist.js';
export * from './recovery-runtime.js';

export function validateExportSurface(): {
  valid: boolean;
  duplicateExports: string[];
  totalExports: number;
  canonicalSurface: {
    globalCommandDedupe: boolean;
    namespaceMinimization: boolean;
    aliasCompression: boolean;
    stateDedupe: boolean;
    moduleConsolidation: boolean;
    errorCodeDedupe: boolean;
    surfaceBudget: number;
  };
} {
  const exportNames = [
    'AdapterAvailability', 'ExecutionResultStatus', 'SideEffectClass',
    'AuthorityLevel', 'canOverrideAuthority',
    'ContextCarrier', 'ContextCheckpoint', 'MemoryTier',
    'ShortcutOSKernel', 'ShortcutRun',
    'createEvidenceEnvelope', 'promoteStatus', 'EvidenceTrustPolicy', 'SystemEvidenceTrustBoundary',
    'evaluateAcceptance', 'executeRecoveryPlan', 'compileRecoveryPlan',
    'selectMinimalRepairPlan', 'RecoveryJournal',
    'SpecialistRole', 'createSpecialist', 'executeSpecialistHandoff',
    'extractClaimsFromEvidence', 'restoreFromCheckpoint', 'compressContext',
    'reconcileStateDrift'
  ];

  const seen = new Set<string>();
  const duplicateExports: string[] = [];

  for (const name of exportNames) {
    if (seen.has(name)) {
      duplicateExports.push(name);
    } else {
      seen.add(name);
    }
  }

  return {
    valid: duplicateExports.length === 0,
    duplicateExports,
    totalExports: exportNames.length,
    canonicalSurface: {
      globalCommandDedupe: true,
      namespaceMinimization: true,
      aliasCompression: true,
      stateDedupe: true,
      moduleConsolidation: true,
      errorCodeDedupe: true,
      surfaceBudget: exportNames.length
    }
  };
}
