export const IMPLEMENTATION_STATES = Object.freeze([
  'IMPLEMENTED_AND_RUNTIME_TESTED',
  'IMPLEMENTED_BUT_UNTESTED',
  'PARTIALLY_IMPLEMENTED',
  'DESIGN_ONLY',
  'NOT_IMPLEMENTED',
  'BLOCKED',
  'UNKNOWN'
]);

const REQUIRED_TOP_LEVEL = Object.freeze([
  'repository_commit',
  'environment',
  'build_result',
  'test_result',
  'self_check_result',
  'source_backed_findings',
  'security_findings',
  'conformance_coverage',
  'test_coverage_gaps',
  'runtime_overclaims',
  'critical_blockers',
  'smallest_safe_next_actions',
  'production_readiness_verdict'
]);

const TOP_LEVEL_SET = new Set(REQUIRED_TOP_LEVEL);
const STATE_SET = new Set(IMPLEMENTATION_STATES);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(report, key, errors) {
  if (!isPlainObject(report[key])) {
    errors.push(`${key} must be an object`);
  }
}

function requireArray(report, key, errors) {
  if (!Array.isArray(report[key])) {
    errors.push(`${key} must be an array`);
  }
}

function validateFinding(item, path, errors, requireClassification = false) {
  if (!isPlainObject(item)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof item.id !== 'string' || item.id.length === 0) {
    errors.push(`${path}.id must be a non-empty string`);
  }
  if (typeof item.summary !== 'string' || item.summary.length === 0) {
    errors.push(`${path}.summary must be a non-empty string`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.some(value => typeof value !== 'string')) {
    errors.push(`${path}.evidence must be an array of strings`);
  }
  if (requireClassification || Object.hasOwn(item, 'classification')) {
    if (!STATE_SET.has(item.classification)) {
      errors.push(`${path}.classification has invalid value ${String(item.classification)}`);
    }
  }
}

export function validateConformanceReport(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { valid: false, errors: ['report must be an object'] };
  }

  for (const key of REQUIRED_TOP_LEVEL) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`missing required top-level field: ${key}`);
    }
  }

  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_SET.has(key)) {
      errors.push(`unknown top-level field: ${key}`);
    }
  }

  if (Object.hasOwn(value, 'repository_commit')
      && (typeof value.repository_commit !== 'string' || value.repository_commit.length === 0)) {
    errors.push('repository_commit must be a non-empty string');
  }

  for (const key of ['environment', 'build_result', 'test_result', 'self_check_result']) {
    if (Object.hasOwn(value, key)) requireObject(value, key, errors);
  }

  for (const key of [
    'source_backed_findings',
    'security_findings',
    'conformance_coverage',
    'test_coverage_gaps',
    'runtime_overclaims',
    'critical_blockers',
    'smallest_safe_next_actions'
  ]) {
    if (Object.hasOwn(value, key)) requireArray(value, key, errors);
  }

  if (Array.isArray(value.source_backed_findings)) {
    value.source_backed_findings.forEach((item, index) => {
      validateFinding(item, `source_backed_findings[${index}]`, errors);
    });
  }
  if (Array.isArray(value.security_findings)) {
    value.security_findings.forEach((item, index) => {
      validateFinding(item, `security_findings[${index}]`, errors);
    });
  }
  if (Array.isArray(value.conformance_coverage)) {
    value.conformance_coverage.forEach((item, index) => {
      validateFinding(item, `conformance_coverage[${index}]`, errors, true);
    });
  }

  if (Object.hasOwn(value, 'production_readiness_verdict')
      && (typeof value.production_readiness_verdict !== 'string'
        || value.production_readiness_verdict.length === 0)) {
    errors.push('production_readiness_verdict must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}
