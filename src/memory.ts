import { assembleContext, type ContextAssembly, type ContextRecord } from './context.js';
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
};

export class MemoryRepository {
  constructor(private readonly store: MemoryTextStore) {}

  async put(input: { eventId: string; record: MemoryRecordInput }): Promise<void> {
    const events = await this.loadEvents();
    this.assertUniqueEvent(events, input.eventId);
    this.assertUniqueRecord(events, input.record.id);
    events.push({ eventId: input.eventId, type: MemoryEventType.PUT, record: structuredClone(input.record) });
    await this.saveEvents(events);
  }

  async correct(input: {
    eventId: string;
    targetId: string;
    replacement: MemoryRecordInput;
  }): Promise<void> {
    const events = await this.loadEvents();
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
    await this.saveEvents(events);
  }

  async tombstone(input: { eventId: string; targetId: string }): Promise<void> {
    const events = await this.loadEvents();
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
    await this.saveEvents(events);
  }

  async history(): Promise<MemoryJournalEvent[]> {
    return structuredClone(await this.loadEvents());
  }

  async records(): Promise<MemoryRecordState[]> {
    return [...this.replay(await this.loadEvents()).values()].map((record) => structuredClone(record));
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

  private async loadEvents(): Promise<MemoryJournalEvent[]> {
    const text = await this.store.read();
    if (text === null || text.trim() === '') {
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
    return parsed as MemoryJournalEvent[];
  }

  private async saveEvents(events: MemoryJournalEvent[]): Promise<void> {
    await this.store.write(JSON.stringify(events, null, 2));
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
