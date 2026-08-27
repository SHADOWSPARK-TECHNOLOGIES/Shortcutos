import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileRecoveryPlan,
  executeRecoveryPlan,
  FailureCategory
} from '../dist/index.js';

test('P9: Failure taxonomy categorizes failures and compiles executable recovery plans', async () => {
  const compensatingLog = [];

  const plan = compileRecoveryPlan({
    failureCode: 'EXECUTION_TIMEOUT',
    isMutation: true,
    compensatingActions: [
      {
        id: 'rollback-temp-file',
        description: 'Delete temporary file created before timeout',
        async run() {
          compensatingLog.push('rollback-temp-file');
        }
      }
    ]
  });

  assert.equal(plan.category, FailureCategory.AMBIGUOUS_MUTATION);
  assert.equal(plan.requiresHumanIntervention, true); // mutating timeout requires human gate!

  // Safe read-only failure plan
  const readOnlyPlan = compileRecoveryPlan({
    failureCode: 'EXECUTION_TIMEOUT',
    isMutation: false,
    compensatingActions: []
  });

  assert.equal(readOnlyPlan.category, FailureCategory.ADAPTER_TIMEOUT);
  assert.equal(readOnlyPlan.requiresHumanIntervention, false);

  const recoveryResult = await executeRecoveryPlan(readOnlyPlan);
  assert.equal(recoveryResult.status, 'RECOVERED_DEGRADED');
});
