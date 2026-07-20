import { validateLeadPayload, validatePatchPayload } from '../../lib/validate-lead';

const basePayload = {
  entity_name: 'ACME FC',
  url: 'https://example.com',
  country: 'US',
  kanbanColumn: 'DISCOVERED',
  ice: { impact: 5, confidence: 5, ease: 5 },
  decision_maker_contact: 'john@example.com',
  contact_phone: '+1-555-555-5555',
  contacts: [{ name: 'John Doe', email: 'john@example.com' }],
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

const validCogmap = validateLeadPayload({ ...basePayload, pro_for_cogmap: ['a'], con_for_cogmap: ['b'] }, 'cogmap');
assert(validCogmap.valid === true, 'valid cogmap payload passes');

const forbiddenSeyuOnCogmap = validateLeadPayload({ ...basePayload, pro_for_seyu: ['x'], con_for_seyu: ['y'] }, 'cogmap');
assert(forbiddenSeyuOnCogmap.valid === false && forbiddenSeyuOnCogmap.errors.some((e) => e.includes('Forbidden field for brand cogmap')), 'forbidden seyu fields blocked on cogmap');

const invalidPatch = validatePatchPayload({ action: 'UNKNOWN' }, 'cogmap');
assert(invalidPatch.valid === false && invalidPatch.errors.some((e) => e.includes('action must be one of')), 'invalid patch action rejected');

const validMove = validatePatchPayload({ action: 'COLUMN_MOVE', kanbanColumn: 'QUALIFIED', sortOrder: 1 }, 'cogmap');
assert(validMove.valid === true, 'valid column move patch passes');

console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
