export type CanonicalRecord = {
  id: string;
};

export class CanonicalRegistry<T extends CanonicalRecord> {
  private readonly records = new Map<string, T>();
  private readonly aliases = new Map<string, string>();

  register(record: T): void {
    if (this.records.has(record.id) || this.aliases.has(record.id)) {
      throw new Error(`REGISTRY_ID_COLLISION:${record.id}`);
    }
    this.records.set(record.id, record);
  }

  registerAlias(alias: string, canonicalId: string): void {
    if (this.records.has(alias) || this.aliases.has(alias)) {
      throw new Error(`REGISTRY_ID_COLLISION:${alias}`);
    }
    if (this.aliases.has(canonicalId)) {
      throw new Error(`REGISTRY_ALIAS_CHAIN_FORBIDDEN:${alias}->${canonicalId}`);
    }
    if (!this.records.has(canonicalId)) {
      throw new Error(`REGISTRY_CANONICAL_TARGET_NOT_FOUND:${canonicalId}`);
    }
    this.aliases.set(alias, canonicalId);
  }

  get(idOrAlias: string): T | undefined {
    const canonicalId = this.aliases.get(idOrAlias) ?? idOrAlias;
    return this.records.get(canonicalId);
  }

  list(): T[] {
    return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  listAliases(): Array<{ alias: string; canonicalId: string }> {
    return [...this.aliases.entries()]
      .map(([alias, canonicalId]) => ({ alias, canonicalId }))
      .sort((a, b) => a.alias.localeCompare(b.alias));
  }
}
