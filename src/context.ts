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
