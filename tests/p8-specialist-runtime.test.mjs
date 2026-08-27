import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpecialistRegistry,
  SpecialistRole,
  executeSpecialistHandoff
} from '../dist/index.js';

test('P8: Specialist registry manages specialist roles, eligibility, and validates handoffs', async () => {
  const registry = new SpecialistRegistry();

  registry.register({
    id: 'sec-spec-1',
    role: SpecialistRole.SECURITY,
    capabilities: ['security.audit', 'code.review'],
    async execute(task) {
      return { status: 'SUCCESS', output: { vulnerabilityCount: 0 }, evidenceRef: 'ev-sec-1' };
    }
  });

  registry.register({
    id: 'arch-spec-1',
    role: SpecialistRole.ARCHITECTURE,
    capabilities: ['system.design'],
    async execute(task) {
      return { status: 'SUCCESS', output: { diagramUrl: 'http://arch' }, evidenceRef: 'ev-arch-1' };
    }
  });

  const eligibleSec = registry.findEligibleSpecialist('security.audit');
  assert.equal(eligibleSec?.id, 'sec-spec-1');
  assert.equal(eligibleSec?.role, SpecialistRole.SECURITY);

  const eligibleArch = registry.findEligibleSpecialist('system.design');
  assert.equal(eligibleArch?.id, 'arch-spec-1');

  // Test handoff between specialists
  const handoff = await executeSpecialistHandoff({
    fromSpecialistId: 'arch-spec-1',
    toSpecialistId: 'sec-spec-1',
    capability: 'security.audit',
    input: { targetCode: 'function main() {}' }
  }, registry);

  assert.equal(handoff.status, 'SUCCESS');
  assert.equal(handoff.executingSpecialistId, 'sec-spec-1');
  assert.equal(handoff.output.vulnerabilityCount, 0);
});
