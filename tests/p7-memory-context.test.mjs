import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContextCarrier,
  MemoryTierManager,
  MemoryTier
} from '../dist/index.js';

test('P7: Context carrier creates verifiable checkpoints and compresses historical state', () => {
  const carrier = new ContextCarrier({ tokenBudget: 500 });

  carrier.addEntry('k1', 'Short message 1', MemoryTier.SHORT_TERM);
  carrier.addEntry('k2', 'Short message 2', MemoryTier.WORKING_SET);
  carrier.addEntry('k3', 'Long message 3 '.repeat(20), MemoryTier.LONG_TERM);

  const checkpoint = carrier.createCheckpoint('cp-1');
  assert.equal(checkpoint.id, 'cp-1');
  assert.equal(checkpoint.entries.length, 3);
  assert.equal(typeof checkpoint.stateHash, 'string');

  const budgetState = carrier.assembleWorkingSet();
  assert.equal(budgetState.totalTokens <= 500, true);
  assert.equal(budgetState.includedKeys.includes('k2'), true);

  const exported = carrier.exportSnapshot();
  const importedCarrier = ContextCarrier.importSnapshot(exported);
  assert.equal(importedCarrier.getEntry('k1')?.value, 'Short message 1');
});
