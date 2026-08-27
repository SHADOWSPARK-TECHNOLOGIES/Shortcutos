import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EvidenceGraph,
  SourceTrustGrade,
  reconcileEvidenceConflicts
} from '../dist/index.js';

test('P6: Contradiction graph detects contradicting claims and resolves conflicts by source grade', () => {
  const graph = new EvidenceGraph();

  graph.addSource({
    id: 'src-official',
    origin: 'official-api',
    grade: SourceTrustGrade.HIGH
  });

  graph.addSource({
    id: 'src-user',
    origin: 'user-input',
    grade: SourceTrustGrade.LOW
  });

  graph.addClaim({
    id: 'c1',
    statement: 'Server status is ONLINE',
    sourceId: 'src-official',
    confidence: 0.95
  });

  graph.addClaim({
    id: 'c2',
    statement: 'Server status is OFFLINE',
    sourceId: 'src-user',
    confidence: 0.80
  });

  // Mark contradiction between claim 1 and claim 2
  graph.addRelation('c1', 'c2', 'CONTRADICTS');

  const conflicts = graph.detectConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].claimAId, 'c1');
  assert.equal(conflicts[0].claimBId, 'c2');

  // Reconciliation favors HIGH trust grade source
  const reconciliation = reconcileEvidenceConflicts(graph);
  assert.equal(reconciliation.acceptedClaimIds.includes('c1'), true);
  assert.equal(reconciliation.rejectedClaimIds.includes('c2'), true);
  assert.equal(reconciliation.traces.length > 0, true);
});
