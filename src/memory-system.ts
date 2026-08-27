export enum MemoryTier {
  SHORT_TERM = 'SHORT_TERM',
  WORKING_SET = 'WORKING_SET',
  LONG_TERM = 'LONG_TERM'
}

export type ContextEntry = {
  key: string;
  value: string;
  tier: MemoryTier;
  estimatedTokens: number;
  timestamp: string;
};

export type ContextCheckpoint = {
  id: string;
  timestamp: string;
  entries: ContextEntry[];
  stateHash: string;
};

export type WorkingSetAssembly = {
  totalTokens: number;
  includedKeys: string[];
  compressedHistory?: string | undefined;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class MemoryTierManager {
  private readonly entries = new Map<string, ContextEntry>();

  set(key: string, value: string, tier: MemoryTier): ContextEntry {
    const entry: ContextEntry = {
      key,
      value,
      tier,
      estimatedTokens: estimateTokens(value),
      timestamp: new Date().toISOString()
    };
    this.entries.set(key, entry);
    return entry;
  }

  get(key: string): ContextEntry | undefined {
    return this.entries.get(key);
  }

  getAll(): ContextEntry[] {
    return Array.from(this.entries.values());
  }
}

export class ContextCarrier {
  private readonly tierManager = new MemoryTierManager();
  private readonly tokenBudget: number;

  constructor(config: { tokenBudget: number }) {
    this.tokenBudget = config.tokenBudget;
  }

  addEntry(key: string, value: string, tier: MemoryTier): ContextEntry {
    return this.tierManager.set(key, value, tier);
  }

  getEntry(key: string): ContextEntry | undefined {
    return this.tierManager.get(key);
  }

  createCheckpoint(id: string): ContextCheckpoint {
    const entries = this.tierManager.getAll();
    const timestamp = new Date().toISOString();
    const stateHash = fnv1a(JSON.stringify({ id, timestamp, entries }));
    return {
      id,
      timestamp,
      entries,
      stateHash
    };
  }

  assembleWorkingSet(): WorkingSetAssembly {
    const all = this.tierManager.getAll();
    // Prioritize WORKING_SET, then SHORT_TERM, then LONG_TERM
    const priorityOrder: Record<MemoryTier, number> = {
      [MemoryTier.WORKING_SET]: 1,
      [MemoryTier.SHORT_TERM]: 2,
      [MemoryTier.LONG_TERM]: 3
    };

    const sorted = [...all].sort((a, b) => priorityOrder[a.tier] - priorityOrder[b.tier]);

    let totalTokens = 0;
    const includedKeys: string[] = [];

    for (const entry of sorted) {
      if (totalTokens + entry.estimatedTokens <= this.tokenBudget) {
        totalTokens += entry.estimatedTokens;
        includedKeys.push(entry.key);
      }
    }

    return {
      totalTokens,
      includedKeys
    };
  }

  exportSnapshot(): string {
    return JSON.stringify({
      tokenBudget: this.tokenBudget,
      entries: this.tierManager.getAll()
    });
  }

  static importSnapshot(snapshotJson: string): ContextCarrier {
    const data = JSON.parse(snapshotJson);
    const carrier = new ContextCarrier({ tokenBudget: data.tokenBudget ?? 1000 });
    for (const item of data.entries ?? []) {
      carrier.addEntry(item.key, item.value, item.tier);
    }
    return carrier;
  }
}
