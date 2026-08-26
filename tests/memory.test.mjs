import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContextFreshness,
  MemoryRecordStatus,
  MemoryRepository
} from '../dist/index.js';

function memoryTextStore() {
  let text = null;
  return {
    async read() {
      return text;
    },
    async write(next) {
      text = next;
    }
  };
}

const baseRecord = {
  id: 'memory-1',
  key: 'project.mode',
  value: 'safe',
  freshness: ContextFreshness.FRESH,
  priority: 10,
  provenance: { kind: 'user', ref: 'turn-1' }
};

test('memory journal persists records through a fresh repository instance', async () => {
  const store = memoryTextStore();
  const first = new MemoryRepository(store);
  await first.put({ eventId: 'event-1', record: baseRecord });

  const second = new MemoryRepository(store);
  const records = await second.records();

  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, 'memory-1');
  assert.equal(records[0]?.status, MemoryRecordStatus.ACTIVE);
  assert.deepEqual(records[0]?.provenance, { kind: 'user', ref: 'turn-1' });
});

test('memory correction preserves history and supersedes the old record', async () => {
  const store = memoryTextStore();
  const repo = new MemoryRepository(store);
  await repo.put({ eventId: 'event-1', record: baseRecord });
  await repo.correct({
    eventId: 'event-2',
    targetId: 'memory-1',
    replacement: {
      ...baseRecord,
      id: 'memory-2',
      value: 'strict',
      provenance: { kind: 'user-correction', ref: 'turn-2' }
    }
  });

  const records = await repo.records();
  const oldRecord = records.find((record) => record.id === 'memory-1');
  const replacement = records.find((record) => record.id === 'memory-2');
  const history = await repo.history();

  assert.equal(oldRecord?.status, MemoryRecordStatus.SUPERSEDED);
  assert.equal(replacement?.status, MemoryRecordStatus.ACTIVE);
  assert.equal(replacement?.supersedes, 'memory-1');
  assert.equal(history.length, 2);
});

test('tombstoned memory stays in history but is excluded from active context', async () => {
  const store = memoryTextStore();
  const repo = new MemoryRepository(store);
  await repo.put({ eventId: 'event-1', record: baseRecord });
  await repo.tombstone({ eventId: 'event-2', targetId: 'memory-1' });

  const records = await repo.records();
  const context = await repo.activeContext();

  assert.equal(records[0]?.status, MemoryRecordStatus.TOMBSTONED);
  assert.equal(context.records.length, 0);
  assert.equal((await repo.history()).length, 2);
});
