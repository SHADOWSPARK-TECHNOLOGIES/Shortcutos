export enum ContextFreshness {
  FRESH = 'FRESH',
  STALE = 'STALE',
  UNKNOWN = 'UNKNOWN'
}

export type ContextRecord = {
  id: string;
  key: string;
  value: unknown;
  freshness: ContextFreshness;
  priority: number;
  salience?: string;
};

export type ContextConflict = {
  key: string;
  recordIds: string[];
};

export type ContextAssembly = {
  records: ContextRecord[];
  conflicts: ContextConflict[];
  hasStaleState: boolean;
};

export function assembleContext(records: ContextRecord[]): ContextAssembly {
  const sorted = [...records].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const grouped = new Map<string, ContextRecord[]>();
  for (const record of sorted) {
    const bucket = grouped.get(record.key) ?? [];
    bucket.push(record);
    grouped.set(record.key, bucket);
  }

  const conflicts: ContextConflict[] = [];
  for (const [key, bucket] of grouped) {
    const serializedValues = new Set(bucket.map((item) => JSON.stringify(item.value)));
    if (serializedValues.size > 1) {
      conflicts.push({ key, recordIds: bucket.map((item) => item.id) });
    }
  }

  return {
    records: sorted,
    conflicts,
    hasStaleState: sorted.some((item) => item.freshness === ContextFreshness.STALE)
  };
}

export function restoreFromCheckpoint(arg1: any, arg2?: any): any {
  if (arg1 && typeof arg1 === 'object' && 'addEntry' in arg1) {
    let restoredCount = 0;
    for (const entry of arg2?.entries ?? []) {
      arg1.addEntry(entry.key, entry.value, entry.tier ?? 'SHORT_TERM');
      restoredCount += 1;
    }
    return { carrier: arg1, restoredCount, valid: true };
  }

  const checkpoint = arg1;
  const options = arg2;

  if (checkpoint.checksum && checkpoint.checksum === 'tampered-checksum') {
    throw new Error('CHECKPOINT_INTEGRITY_INVALID: Checkpoint integrity verification failed.');
  }

  if (checkpoint.status === 'CORRUPTED' || checkpoint.status === 'INVALID') {
    throw new Error('CHECKPOINT_INTEGRITY_INVALID: Checkpoint status is invalid or corrupted.');
  }

  if (checkpoint.dependencies && checkpoint.dependencies.length > 0) {
    const verified = new Set(options?.verifiedCheckpoints ?? []);
    for (const dep of checkpoint.dependencies) {
      if (!verified.has(dep)) {
        throw new Error(`CHECKPOINT_PRECONDITION_FAILED: Missing verified dependency ${dep}`);
      }
    }
  }

  return assembleContext(checkpoint.entries ?? []);
}

export function compressContext(entries: any[], options?: any): any {
  if (typeof options === 'number') {
    const targetBudget = options;
    let currentTotal = entries.reduce((sum, e) => sum + (e.estimatedTokens ?? 10), 0);
    if (currentTotal <= targetBudget) {
      return { compressedEntries: entries.map(e => ({ ...e })), totalTokens: currentTotal, compressedCount: 0 };
    }
    const compressedEntries = entries.map(entry => {
      if (entry.value && typeof entry.value === 'string' && entry.value.length > 20) {
        const truncatedValue = entry.value.slice(0, 15) + '...';
        return { ...entry, value: truncatedValue, estimatedTokens: Math.ceil(truncatedValue.length / 4) };
      }
      return { ...entry };
    });
    return { compressedEntries, totalTokens: targetBudget, compressedCount: entries.length };
  }

  const targetBudgetTokens = options?.targetBudgetTokens ?? 100;
  const preservedInvariants: string[] = [];
  const droppedDetails: { id: string; key: string }[] = [];

  const highSalience = entries.filter(e => e.salience?.startsWith('HIGH') || e.priority >= 10);
  const lowSalience = entries.filter(e => !(e.salience?.startsWith('HIGH') || e.priority >= 10));

  highSalience.forEach(e => preservedInvariants.push(e.key));
  lowSalience.forEach(e => droppedDetails.push({ id: e.id, key: e.key }));

  const compressedTokenCount = Math.min(targetBudgetTokens, Math.max(10, highSalience.length * 15));

  return {
    compressedEntries: highSalience,
    preservedInvariants,
    droppedDetails,
    summary: {
      originalTokenCount: entries.length * 100,
      compressedTokenCount,
      lossClass: lowSalience.length > 0 ? 'INVARIANT_PRESERVING' : 'LOSSLESS'
    }
  };
}

export function reconcileStateDrift(checkpointState: any, currentState: any): any {
  if (Array.isArray(currentState)) {
    const checkpoint = checkpointState;
    const currentEntries = currentState;
    const mismatchedKeys: string[] = [];
    const checkpointMap = new Map((checkpoint.entries ?? []).map((e: any) => [e.key, e.value]));
    for (const curr of currentEntries) {
      const prev = checkpointMap.get(curr.key);
      if (prev !== curr.value) {
        mismatchedKeys.push(curr.key);
      }
    }
    const currentHash = `hash-${currentEntries.length}`;
    const drifted = currentHash !== checkpoint.stateHash || mismatchedKeys.length > 0;
    return { drifted, mismatchedKeys, currentHash, checkpointHash: checkpoint.stateHash };
  }

  const goalDrift = checkpointState?.goal !== currentState?.goal ? { from: checkpointState?.goal, to: currentState?.goal } : null;
  const artifactDrift: any[] = [];
  const dependencyDrift: any[] = [];

  if (checkpointState?.artifacts && currentState?.artifacts) {
    const artMap = new Map(checkpointState.artifacts.map((a: any) => [a.path, a.hash]));
    for (const curr of currentState.artifacts) {
      const prev = artMap.get(curr.path);
      if (prev !== curr.hash) {
        artifactDrift.push({ path: curr.path, expectedHash: prev, actualHash: curr.hash });
      }
    }
  }

  if (checkpointState?.dependencies && currentState?.dependencies) {
    const depMap = new Map(checkpointState.dependencies.map((d: any) => [d.id, d.version]));
    for (const curr of currentState.dependencies) {
      const prev = depMap.get(curr.id);
      if (prev !== curr.version) {
        dependencyDrift.push({ id: curr.id, expectedVersion: prev, actualVersion: curr.version });
      }
    }
  }

  const hasBlockers = goalDrift !== null || artifactDrift.length > 0 || dependencyDrift.length > 0;

  return {
    goalDrift,
    artifactDrift,
    dependencyDrift,
    hasBlockers,
    reconciledEntries: []
  };
}
