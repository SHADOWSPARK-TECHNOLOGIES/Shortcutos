import test from 'node:test';
import assert from 'node:assert/strict';
import { canOverride, AuthorityLevel } from '../dist/authority.js';

test('higher authority can override lower authority', () => {
  assert.equal(canOverride(AuthorityLevel.SYSTEM, AuthorityLevel.SHORTCUTOS), true);
  assert.equal(canOverride(AuthorityLevel.USER, AuthorityLevel.SHORTCUTOS), true);
});

test('ShortcutOS cannot override higher authority', () => {
  assert.equal(canOverride(AuthorityLevel.SHORTCUTOS, AuthorityLevel.USER), false);
  assert.equal(canOverride(AuthorityLevel.SHORTCUTOS, AuthorityLevel.TOOL_RUNTIME), false);
  assert.equal(canOverride(AuthorityLevel.SHORTCUTOS, AuthorityLevel.DEVELOPER), false);
  assert.equal(canOverride(AuthorityLevel.SHORTCUTOS, AuthorityLevel.SYSTEM), false);
});
