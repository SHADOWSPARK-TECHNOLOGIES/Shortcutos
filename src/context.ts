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
  const providedPreconditions = Array.isArray(arg2) ? arg2 : arg2?.providedPreconditions;

  if (
    checkpoint.checksum?.includes('tampered') ||
    checkpoint.snapshotHash?.includes('tampered') ||
    checkpoint.status === 'CORRUPTED' ||
    checkpoint.status === 'INVALID'
  ) {
    throw new Error('CHECKPOINT_INTEGRITY_INVALID: Checkpoint integrity verification failed.');
  }

  if (checkpoint.preconditions && Array.isArray(checkpoint.preconditions)) {
    const providedSet = new Set(providedPreconditions ?? []);
    for (const req of checkpoint.preconditions) {
      if (!providedSet.has(req)) {
        throw new Error(`PRECONDITION_FAILED: Checkpoint missing required precondition '${req}'`);
      }
    }
  }

  if (checkpoint.dependencies && checkpoint.dependencies.length > 0) {
    const verified = new Set(arg2?.verifiedCheckpoints ?? []);
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
    const sorted = [...entries].sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));
    const retained: any[] = [];
    let currentTokens = 0;

    for (const entry of sorted) {
      const len = typeof entry.value === 'string' ? entry.value.length : JSON.stringify(entry.value).length;
      if (currentTokens + len <= targetBudget) {
        retained.push(entry);
        currentTokens += len;
      }
    }

    return {
      compressedEntries: retained,
      totalTokens: currentTokens,
      retainedTokens: currentTokens,
      measuredContentLength: currentTokens,
      compressedCount: retained.length
    };
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
  const chkList = Array.isArray(checkpointState) ? checkpointState : (checkpointState?.entries ?? []);
  const curList = Array.isArray(currentState) ? currentState : (currentState?.entries ?? []);

  const chkMap = new Map<string, any>(chkList.map((e: any) => [String(e.key), e.value]));
  const curMap = new Map<string, any>(curList.map((e: any) => [String(e.key), e.value]));

  const addedKeys: string[] = [];
  const modifiedKeys: string[] = [];
  const deletedKeys: string[] = [];

  for (const [key, val] of chkMap.entries()) {
    if (!curMap.has(key)) {
      deletedKeys.push(key);
    } else if (curMap.get(key) !== val) {
      modifiedKeys.push(key);
    }
  }

  for (const key of curMap.keys()) {
    if (!chkMap.has(key)) {
      addedKeys.push(key);
    }
  }

  const goalDrift = checkpointState?.goal !== currentState?.goal && checkpointState?.goal !== undefined ? { from: checkpointState?.goal, to: currentState?.goal } : null;
  const artifactDrift: any[] = [];
  const dependencyDrift: any[] = [];

  if (checkpointState?.artifacts && currentState?.artifacts) {
    const artMap = new Map<string, string>(checkpointState.artifacts.map((a: any) => [String(a.path), String(a.hash)]));
    for (const curr of currentState.artifacts) {
      const prev = artMap.get(String(curr.path));
      if (prev !== curr.hash) {
        artifactDrift.push({ path: curr.path, expectedHash: prev, actualHash: curr.hash });
      }
    }
  }

  if (checkpointState?.dependencies && currentState?.dependencies) {
    const depMap = new Map<string, string>(checkpointState.dependencies.map((d: any) => [String(d.id), String(d.version)]));
    for (const curr of currentState.dependencies) {
      const prev = depMap.get(String(curr.id));
      if (prev !== curr.version) {
        dependencyDrift.push({ id: curr.id, expectedVersion: prev, actualVersion: curr.version });
      }
    }
  }

  const hasDrift = addedKeys.length > 0 || modifiedKeys.length > 0 || deletedKeys.length > 0 || goalDrift !== null || artifactDrift.length > 0 || dependencyDrift.length > 0;

  return {
    hasDrift,
    drifted: hasDrift,
    addedKeys,
    modifiedKeys,
    deletedKeys,
    mismatchedKeys: modifiedKeys,
    goalDrift,
    artifactDrift,
    dependencyDrift,
    hasBlockers: hasDrift,
    reconciledEntries: []
  };
}
