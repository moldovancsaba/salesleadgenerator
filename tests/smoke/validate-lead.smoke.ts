import { validateLeadPayload, validatePatchPayload } from '../../lib/validate-lead';

const basePayload = {
  entity_name: 'ACME FC',
  url: 'https://example.com',
  country: 'US',
  kanbanColumn: 'DISCOVERED',
  ice: { impact: 5, confidence: 5, ease: 5 },
  contacts: [{ name: 'John Doe', email: 'john@example.com', phone: '+1-555-555-5555', isDecisionMaker: true }],
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

console.log('Running validation smoke tests...');

const validCogmap = validateLeadPayload({ ...basePayload, pro_for_organization: ['a'], con_for_organization: ['b'] }, 'cogmap');
assert(validCogmap.valid === true, 'valid cogmap payload passes');

const validSeyu = validateLeadPayload({ ...basePayload, pro_for_organization: ['a'], con_for_organization: ['b'] }, 'seyu');
assert(validSeyu.valid === true, 'valid seyu payload passes with the same generic pro/con field');

const malformedProField = validateLeadPayload({ ...basePayload, pro_for_organization: 'not-an-array' }, 'cogmap');
assert(malformedProField.valid === false && malformedProField.errors.some((e) => e.includes('pro_for_organization must be an array of strings')), 'non-array pro_for_organization rejected');

const invalidPatch = validatePatchPayload({ action: 'UNKNOWN' }, 'cogmap');
assert(invalidPatch.valid === false && invalidPatch.errors.some((e) => e.includes('action must be one of')), 'invalid patch action rejected');

const validMove = validatePatchPayload({ action: 'COLUMN_MOVE', kanbanColumn: 'QUALIFIED', sortOrder: 1 }, 'cogmap');
assert(validMove.valid === true, 'valid column move patch passes');

console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
