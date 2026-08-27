import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalRegistry } from '../dist/registry.js';

test('canonical registry rejects duplicate ids', () => {
  const registry = new CanonicalRegistry();
  registry.register({ id: 'command.run', purpose: 'run command' });
  assert.throws(
    () => registry.register({ id: 'command.run', purpose: 'duplicate' }),
    /REGISTRY_ID_COLLISION/
  );
});

test('direct alias resolves to canonical record', () => {
  const registry = new CanonicalRegistry();
  registry.register({ id: 'quality.verify', purpose: 'verify' });
  registry.registerAlias('verify', 'quality.verify');
  assert.equal(registry.get('verify')?.id, 'quality.verify');
});

test('alias chains are rejected', () => {
  const registry = new CanonicalRegistry();
  registry.register({ id: 'quality.verify', purpose: 'verify' });
  registry.registerAlias('verify', 'quality.verify');
  assert.throws(() => registry.registerAlias('check', 'verify'), /REGISTRY_ALIAS_CHAIN_FORBIDDEN/);
});
