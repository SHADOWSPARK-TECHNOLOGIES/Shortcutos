import { assembleContext, type ContextAssembly, type ContextRecord, ContextFreshness } from './context.js';
import { ShortcutOSError } from './errors.js';

export enum MemoryRecordStatus {
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
  TOMBSTONED = 'TOMBSTONED'
}

export enum MemoryEventType {
  PUT = 'PUT',
  SUPERSEDE = 'SUPERSEDE',
  TOMBSTONE = 'TOMBSTONE'
}

export type MemoryProvenance = {
  kind: string;
  ref: string;
};

export type MemoryRecordInput = ContextRecord & {
  provenance: MemoryProvenance;
};

export type MemoryRecordState = MemoryRecordInput & {
  status: MemoryRecordStatus;
  supersedes: string | null;
};

export type MemoryPutEvent = {
  eventId: string;
  type: MemoryEventType.PUT;
  record: MemoryRecordInput;
};

export type MemorySupersedeEvent = {
  eventId: string;
  type: MemoryEventType.SUPERSEDE;
  targetId: string;
  replacement: MemoryRecordInput;
};

export type MemoryTombstoneEvent = {
  eventId: string;
  type: MemoryEventType.TOMBSTONE;
  targetId: string;
};

export type MemoryJournalEvent =
  | MemoryPutEvent
  | MemorySupersedeEvent
  | MemoryTombstoneEvent;

export type MemoryTextStore = {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  acquireLock?(options?: { ownerToken?: string; leaseMs?: number }): Promise<{ ownerToken: string; release: () => Promise<void> }>;
  releaseLock?(ownerToken: string): Promise<void>;
  withLock?<T>(fn: (transaction: { read(): Promise<string | null>; write(text: string): Promise<void> }) => Promise<T>, options?: { leaseMs?: number }): Promise<T>;
};

export class MemoryRepository {
  private currentEvents: MemoryJournalEvent[] = [];

  constructor(private readonly store: MemoryTextStore) {}

  get version(): number {
    return this.currentEvents.length;
  }

  private async executeLocked<T>(fn: (tx?: { read(): Promise<string | null>; write(text: string): Promise<void> }) => Promise<T>): Promise<T> {
    if (typeof this.store.withLock === 'function') {
      return this.store.withLock(fn);
    }
    return fn();
  }

  async put(input: {
    eventId: string;
    record: MemoryRecordInput;
    expectedVersion?: number;
  }): Promise<void> {
    return this.executeLocked(async (tx) => {
      this.validateRecordInput(input.record, input.eventId);
      const events = await this.loadEvents(tx);
      this.checkConcurrency(events, input.expectedVersion, input.eventId);
      this.assertUniqueEvent(events, input.eventId);
      this.assertUniqueRecord(events, input.record.id);
      events.push({ eventId: input.eventId, type: MemoryEventType.PUT, record: structuredClone(input.record) });
      await this.saveEvents(events, tx);
    });
  }

  async correct(input: {
    eventId: string;
    targetId: string;
    replacement: MemoryRecordInput;
    expectedVersion?: number;
  }): Promise<void> {
    return this.executeLocked(async (tx) => {
      this.validateRecordInput(input.replacement, input.eventId);
      const events = await this.loadEvents(tx);
      this.checkConcurrency(events, input.expectedVersion, input.eventId);
      this.assertUniqueEvent(events, input.eventId);
      this.assertUniqueRecord(events, input.replacement.id);
      const state = this.replay(events);
      const target = state.get(input.targetId);
      if (!target || target.status !== MemoryRecordStatus.ACTIVE) {
        throw this.memoryError(
          'MEMORY_CORRECTION_TARGET_INVALID',
          input.targetId,
          'Only an active memory record can be corrected.',
          'Select an active memory record before applying a correction.'
        );
      }
      events.push({
        eventId: input.eventId,
        type: MemoryEventType.SUPERSEDE,
        targetId: input.targetId,
        replacement: structuredClone(input.replacement)
      });
      await this.saveEvents(events, tx);
    });
  }

  async tombstone(input: {
    eventId: string;
    targetId: string;
    expectedVersion?: number;
  }): Promise<void> {
    return this.executeLocked(async (tx) => {
      const events = await this.loadEvents(tx);
      this.checkConcurrency(events, input.expectedVersion, input.eventId);
      this.assertUniqueEvent(events, input.eventId);
      const state = this.replay(events);
      const target = state.get(input.targetId);
      if (!target || target.status !== MemoryRecordStatus.ACTIVE) {
        throw this.memoryError(
          'MEMORY_TOMBSTONE_TARGET_INVALID',
          input.targetId,
          'Only an active memory record can be tombstoned.',
          'Select an active memory record before tombstoning it.'
        );
      }
      events.push({ eventId: input.eventId, type: MemoryEventType.TOMBSTONE, targetId: input.targetId });
      await this.saveEvents(events, tx);
    });
  }

  async history(): Promise<MemoryJournalEvent[]> {
    return structuredClone(await this.loadEvents());
  }

  async records(): Promise<MemoryRecordState[]> {
    return [...this.replay(await this.loadEvents()).values()].map((record) => structuredClone(record));
  }

  async getActiveRecords(): Promise<MemoryRecordState[]> {
    return (await this.records()).filter((record) => record.status === MemoryRecordStatus.ACTIVE);
  }

  async activeContext(): Promise<ContextAssembly> {
    const active = (await this.records())
      .filter((record) => record.status === MemoryRecordStatus.ACTIVE)
      .map<ContextRecord>(({ id, key, value, freshness, priority }) => ({
        id,
        key,
        value,
        freshness,
        priority
      }));
    return assembleContext(active);
  }

  private validateRecordInput(record: MemoryRecordInput, eventId: string): void {
    if (!record || typeof record !== 'object') {
      throw this.memoryError('MEMORY_SCHEMA_INVALID', eventId, 'Memory record must be an object.', 'Provide a valid memory record object.');
    }
    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      throw this.memoryError('MEMORY_SCHEMA_INVALID', eventId, 'Memory record id must be a non-empty string.', 'Provide a non-empty string for record id.');
    }
    if (typeof record.key !== 'string' || record.key.trim().length === 0) {
      throw this.memoryError('MEMORY_SCHEMA_INVALID', eventId, 'Memory record key must be a non-empty string.', 'Provide a non-empty string for record key.');
    }
    if (!record.freshness || !Object.values(ContextFreshness).includes(record.freshness)) {
      throw this.memoryError('MEMORY_SCHEMA_INVALID', eventId, 'Memory record freshness must be a valid ContextFreshness enum value.', 'Provide a valid freshness value.');
    }
    if (typeof record.priority !== 'number' || Number.isNaN(record.priority)) {
      throw this.memoryError('MEMORY_SCHEMA_INVALID', eventId, 'Memory record priority must be a number.', 'Provide a number for record priority.');
    }
    if (!record.provenance || typeof record.provenance !== 'object') {
      throw this.memoryError('MEMORY_SCHEMA_INVALID', eventId, 'Memory record provenance is required.', 'Provide a provenance object.');
    }
  }

  private checkConcurrency(events: MemoryJournalEvent[], expectedVersion: number | undefined, eventId: string): void {
    if (expectedVersion !== undefined && expectedVersion !== events.length) {
      throw this.memoryError(
        'MEMORY_CONCURRENCY_CONFLICT',
        eventId,
        `Memory concurrency conflict: expected version ${expectedVersion}, but store is at version ${events.length}.`,
        'Reload current memory state and retry operation with updated expected version.'
      );
    }
  }

  private async loadEvents(tx?: { read(): Promise<string | null>; write(text: string): Promise<void> }): Promise<MemoryJournalEvent[]> {
    const text = tx ? await tx.read() : await this.store.read();
    if (text === null || text.trim() === '') {
      this.currentEvents = [];
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.memoryError(
        'MEMORY_STORE_INVALID_JSON',
        'memory-store',
        'The memory store is not valid JSON.',
        'Restore a valid journal or replace the corrupted store.'
      );
    }
    if (!Array.isArray(parsed)) {
      throw this.memoryError(
        'MEMORY_STORE_INVALID_FORMAT',
        'memory-store',
        'The memory store must contain a JSON array of journal events.',
        'Restore a valid ShortcutOS memory journal.'
      );
    }
    this.currentEvents = parsed as MemoryJournalEvent[];
    return this.currentEvents;
  }

  private async saveEvents(events: MemoryJournalEvent[], tx?: { read(): Promise<string | null>; write(text: string): Promise<void> }): Promise<void> {
    this.currentEvents = events;
    const content = JSON.stringify(events, null, 2);
    if (tx) {
      await tx.write(content);
    } else {
      await this.store.write(content);
    }
  }

  private replay(events: MemoryJournalEvent[]): Map<string, MemoryRecordState> {
    const records = new Map<string, MemoryRecordState>();
    for (const event of events) {
      switch (event.type) {
        case MemoryEventType.PUT:
          records.set(event.record.id, {
            ...structuredClone(event.record),
            status: MemoryRecordStatus.ACTIVE,
            supersedes: null
          });
          break;
        case MemoryEventType.SUPERSEDE: {
          const target = records.get(event.targetId);
          if (!target) {
            throw this.memoryError(
              'MEMORY_HISTORY_TARGET_MISSING',
              event.targetId,
              'A supersede event references a missing memory record.',
              'Repair the journal before using the memory store.'
            );
          }
          target.status = MemoryRecordStatus.SUPERSEDED;
          records.set(event.replacement.id, {
            ...structuredClone(event.replacement),
            status: MemoryRecordStatus.ACTIVE,
            supersedes: event.targetId
          });
          break;
        }
        case MemoryEventType.TOMBSTONE: {
          const target = records.get(event.targetId);
          if (!target) {
            throw this.memoryError(
              'MEMORY_HISTORY_TARGET_MISSING',
              event.targetId,
              'A tombstone event references a missing memory record.',
              'Repair the journal before using the memory store.'
            );
          }
          target.status = MemoryRecordStatus.TOMBSTONED;
          break;
        }
        default:
          throw this.memoryError(
            'MEMORY_EVENT_UNKNOWN',
            'memory-store',
            'The memory journal contains an unknown event type.',
            'Migrate the journal using a compatible ShortcutOS version.'
          );
      }
    }
    return records;
  }

  private assertUniqueEvent(events: MemoryJournalEvent[], eventId: string): void {
    if (events.some((event) => event.eventId === eventId)) {
      throw this.memoryError(
        'MEMORY_EVENT_ID_COLLISION',
        eventId,
        'Memory event IDs must be unique.',
        'Use a new event ID.'
      );
    }
  }

  private assertUniqueRecord(events: MemoryJournalEvent[], recordId: string): void {
    if (this.replay(events).has(recordId)) {
      throw this.memoryError(
        'MEMORY_RECORD_ID_COLLISION',
        recordId,
        'Memory record IDs must be unique.',
        'Use a new memory record ID.'
      );
    }
  }

  private memoryError(code: string, scope: string, message: string, safeNextAction: string): ShortcutOSError {
    return new ShortcutOSError({
      code,
      message,
      scope,
      retryable: false,
      safeNextAction
    });
  }
}
