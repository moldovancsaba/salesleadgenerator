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
    const result = validateLeadPayload({ ...basePayload, pro_for_organization: ['a'], con_for_organization: ['b'] }, 'cogmap');
    expect(result.valid).toBe(true);
  });

  it('accepts the same generic pro/con field on both brands', () => {
    const cogmapResult = validateLeadPayload({ ...basePayload, pro_for_organization: ['x'], con_for_organization: ['y'] }, 'cogmap');
    const seyuResult = validateLeadPayload({ ...basePayload, pro_for_organization: ['x'], con_for_organization: ['y'] }, 'seyu');
    expect(cogmapResult.valid).toBe(true);
    expect(seyuResult.valid).toBe(true);
  });

  it('rejects a non-array pro_for_organization value', () => {
    const result = validateLeadPayload({ ...basePayload, pro_for_organization: 'not-an-array' }, 'cogmap');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pro_for_organization must be an array of strings'))).toBe(true);
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

  it('allows a payload with no size field at all (not required)', () => {
    const result = validateLeadPayload(basePayload, 'cogmap');
    expect(result.valid).toBe(true);
  });

  it('allows each of the 4 documented size values', () => {
    for (const size of ['Small', 'Medium', 'Large', 'Enterprise']) {
      const result = validateLeadPayload({ ...basePayload, size }, 'cogmap');
      expect(result.valid).toBe(true);
    }
  });

  it('rejects a free-text size value outside the documented enum', () => {
    const result = validateLeadPayload({ ...basePayload, size: 'Pan-European league' }, 'cogmap');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('size must be one of: Small, Medium, Large, Enterprise'))).toBe(true);
  });
});

describe('validateLeadPayload with { partial: true } (used by PUT /api/leads/:id)', () => {
  it('allows a minimal partial update touching only one unrelated field', () => {
    const result = validateLeadPayload({ notes: 'called back, interested' }, 'cogmap', { partial: true });
    expect(result.valid).toBe(true);
  });

  it('still rejects a malformed url if url is included in the partial payload', () => {
    const result = validateLeadPayload({ url: 'not-a-url' }, 'cogmap', { partial: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('url must be a valid HTTP(S) URL'))).toBe(true);
  });

  it('still rejects an out-of-range ICE value if ice is included in the partial payload', () => {
    const result = validateLeadPayload({ ice: { impact: 0, confidence: 5, ease: 5 } }, 'cogmap', { partial: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ice.impact must be a number between 1 and 10'))).toBe(true);
  });

  it('still rejects a non-array pro_for_organization value on a partial update', () => {
    const result = validateLeadPayload({ pro_for_organization: 'not-an-array' }, 'cogmap', { partial: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pro_for_organization must be an array of strings'))).toBe(true);
  });

  it('a full payload with { partial: true } behaves the same as without it', () => {
    const withPartial = validateLeadPayload(basePayload, 'cogmap', { partial: true });
    const withoutPartial = validateLeadPayload(basePayload, 'cogmap');
    expect(withPartial.valid).toBe(true);
    expect(withoutPartial.valid).toBe(true);
  });

  it('rejects an out-of-enum size on a partial update that only touches size', () => {
    const result = validateLeadPayload({ size: 'Pan-European league' }, 'cogmap', { partial: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('size must be one of'))).toBe(true);
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
