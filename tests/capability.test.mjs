import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityAvailability,
  CapabilityBindingStatus,
  CapabilityResolver
} from '../dist/capability.js';

test('unknown capability availability never becomes bound', () => {
  const resolver = new CapabilityResolver([
    { providerId: 'tool-a', capability: 'write.file', availability: CapabilityAvailability.UNKNOWN }
  ]);
  const result = resolver.resolve('write.file');
  assert.equal(result.status, CapabilityBindingStatus.UNKNOWN);
});

test('observed available provider can bind exact capability', () => {
  const resolver = new CapabilityResolver([
    { providerId: 'tool-a', capability: 'write.file', availability: CapabilityAvailability.AVAILABLE }
  ]);
  const result = resolver.resolve('write.file');
  assert.equal(result.status, CapabilityBindingStatus.BOUND);
  assert.equal(result.providerId, 'tool-a');
});

test('missing capability is unavailable rather than invented', () => {
  const resolver = new CapabilityResolver([]);
  const result = resolver.resolve('network.deploy');
  assert.equal(result.status, CapabilityBindingStatus.UNAVAILABLE);
  assert.equal(result.providerId, null);
});
