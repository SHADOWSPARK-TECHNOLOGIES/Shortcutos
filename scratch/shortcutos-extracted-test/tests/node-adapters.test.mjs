import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContextFreshness,
  MemoryRepository,
  ToolAdapterRegistry,
  createDispatch,
  DispatchStatus,
  executeOnce,
  ExecutionResultStatus
} from '../dist/index.js';
import {
  createNodeMemoryTextStore,
  createLocalFileReadAdapter
} from '../node-adapters.mjs';

test('node memory store survives a fresh repository instance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shortcutos-memory-'));
  const file = join(dir, 'memory.json');

  const first = new MemoryRepository(createNodeMemoryTextStore(file));
  await first.put({
    eventId: 'event-1',
    record: {
      id: 'memory-1',
      key: 'project.state',
      value: 'verified',
      freshness: ContextFreshness.FRESH,
      priority: 5,
      provenance: { kind: 'local-test', ref: 'node-memory-1' }
    }
  });

  const second = new MemoryRepository(createNodeMemoryTextStore(file));
  const records = await second.records();
  const raw = JSON.parse(await readFile(file, 'utf8'));

  assert.equal(records[0]?.value, 'verified');
  assert.equal(raw.length, 1);
});

test('local file adapter performs one real root-confined file read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shortcutos-file-'));
  await writeFile(join(dir, 'hello.txt'), 'hello ShortcutOS', 'utf8');

  const adapters = new ToolAdapterRegistry();
  adapters.register(createLocalFileReadAdapter({ id: 'node.file.read', root: dir }));

  const dispatch = createDispatch({
    id: 'dispatch-file-1',
    capability: 'file.read',
    adapterId: 'node.file.read',
    input: { path: 'hello.txt' }
  }, adapters);

  assert.equal(dispatch.status, DispatchStatus.READY_FOR_EXECUTION);
  const result = await executeOnce(dispatch, adapters);

  assert.equal(result.status, ExecutionResultStatus.SUCCEEDED);
  assert.deepEqual(result.output, { path: 'hello.txt', text: 'hello ShortcutOS' });
  assert.equal(result.evidence.length, 1);
  assert.match(result.evidence[0]?.ref ?? '', /hello\.txt$/);
});

test('local file adapter blocks path traversal outside its root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shortcutos-file-root-'));
  const outside = join(dir, '..', 'outside-shortcutos.txt');
  await writeFile(outside, 'secret', 'utf8');

  const adapters = new ToolAdapterRegistry();
  adapters.register(createLocalFileReadAdapter({ id: 'node.file.read', root: dir }));
  const dispatch = createDispatch({
    id: 'dispatch-file-2',
    capability: 'file.read',
    adapterId: 'node.file.read',
    input: { path: '../outside-shortcutos.txt' }
  }, adapters);

  const result = await executeOnce(dispatch, adapters);
  assert.equal(result.status, ExecutionResultStatus.FAILED);
  assert.equal(result.error?.code, 'EXECUTION_INVOCATION_FAILED');
  assert.match(result.error?.message ?? '', /outside configured root/i);
});
