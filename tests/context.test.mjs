import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleContext, ContextFreshness } from '../dist/context.js';

test('stale context is surfaced', () => {
  const result = assembleContext([
    { id: 'a', key: 'project-state', value: 'old', freshness: ContextFreshness.STALE, priority: 1 }
  ]);
  assert.equal(result.records[0]?.freshness, ContextFreshness.STALE);
  assert.equal(result.hasStaleState, true);
});

test('conflicting context is surfaced instead of silently merged', () => {
  const result = assembleContext([
    { id: 'a', key: 'mode', value: 'safe', freshness: ContextFreshness.FRESH, priority: 1 },
    { id: 'b', key: 'mode', value: 'fast', freshness: ContextFreshness.FRESH, priority: 1 }
  ]);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0]?.recordIds, ['a', 'b']);
});
