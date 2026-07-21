import { describe, it, expect } from 'vitest';
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

describe('validateLeadPayload', () => {
  it('allows valid cogmap payload', () => {
    const result = validateLeadPayload({ ...basePayload, pro_for_cogmap: ['a'], con_for_cogmap: ['b'] }, 'cogmap');
    expect(result.valid).toBe(true);
  });

  it('blocks forbidden seyu fields on cogmap payload', () => {
    const result = validateLeadPayload({ ...basePayload, pro_for_seyu: ['x'], con_for_seyu: ['y'] }, 'cogmap');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Forbidden field for brand cogmap'))).toBe(true);
  });

  it('blocks forbidden cogmap fields on seyu payload', () => {
    const result = validateLeadPayload({ ...basePayload, pro_for_cogmap: ['x'], con_for_cogmap: ['y'] }, 'seyu');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Forbidden field for brand seyu'))).toBe(true);
  });

  it('rejects invalid country and bad URL', () => {
    const result = validateLeadPayload({ ...basePayload, country: 'USA', url: 'not-a-url' }, 'cogmap');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('country must be a 2-letter ISO code');
    expect(result.errors.some((e) => e.includes('url must be a valid HTTP(S) URL'))).toBe(true);
  });

  it('rejects invalid ICE values', () => {
    const result = validateLeadPayload({ ...basePayload, ice: { impact: 0, confidence: 11, ease: 5 } }, 'cogmap');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ice.impact must be a number between 1 and 10'))).toBe(true);
    expect(result.errors.some((e) => e.includes('ice.confidence must be a number between 1 and 10'))).toBe(true);
  });
});

describe('validatePatchPayload', () => {
  it('rejects non-whitelisted action', () => {
    const result = validatePatchPayload({ action: 'UNKNOWN' }, 'cogmap');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('action must be one of'))).toBe(true);
  });

  it('allows COLUMN_MOVE with allowed fields', () => {
    const result = validatePatchPayload({ action: 'COLUMN_MOVE', kanbanColumn: 'QUALIFIED', sortOrder: 1 }, 'cogmap');
    expect(result.valid).toBe(true);
  });
});
