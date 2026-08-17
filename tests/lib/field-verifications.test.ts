import { describe, it, expect } from 'vitest';
import {
  normalizeFieldVerifications,
  validateFieldVerifications,
  isContactFieldPath,
  MAX_FIELD_VERIFICATIONS,
} from '../../lib/field-verifications';
import { validateLeadPayload } from '../../lib/validate-lead';
import { dedupeContacts, normalizeContact } from '../../lib/contacts';

const at = (iso: string) => iso;
const entry = (over: Record<string, any> = {}) => ({
  field: 'value_proposition',
  verifiedAt: at('2026-08-01T10:00:00.000Z'),
  method: 'official',
  ...over,
});

describe('validateFieldVerifications — method enum is closed', () => {
  it('rejects a method outside the nine-value taxonomy', () => {
    const errors = validateFieldVerifications([entry({ method: 'scraped' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('method must be one of');
  });

  it('accepts every documented method', () => {
    const methods = ['official', 'official_social', 'public', 'registration_system',
      'phone', 'email', 'admin', 'user', 'ai_generated'];
    for (const method of methods) {
      expect(validateFieldVerifications([entry({ method })])).toEqual([]);
    }
  });

  it('rejects a missing method rather than defaulting one', () => {
    const errors = validateFieldVerifications([{ field: 'notes', verifiedAt: at('2026-08-01T10:00:00.000Z') }]);
    expect(errors.some((e) => e.includes('method'))).toBe(true);
  });
});

describe('validateFieldVerifications — contact paths rejected at lead scope', () => {
  it('rejects a positional contact path outright', () => {
    const errors = validateFieldVerifications([entry({ field: 'contacts[0].phone' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('must not address a contact');
  });

  it('rejects every spelling of a contact path, not just the bracket form', () => {
    for (const field of ['contacts', 'contacts[0].phone', 'contacts.0.phone', 'contacts[email=a@b.co].phone', '  Contacts[1].email']) {
      expect(isContactFieldPath(field)).toBe(true);
      expect(validateFieldVerifications([entry({ field })])).toHaveLength(1);
    }
  });

  it('allows a bare contact field name at contact scope — the contact object identifies whose it is', () => {
    expect(validateFieldVerifications([entry({ field: 'phone' })], 'contact')).toEqual([]);
    // ...and the lead-scope rejection does not leak into contact scope
    expect(validateFieldVerifications([entry({ field: 'contacts[0].phone' })], 'contact')).toEqual([]);
  });

  it('does not reject a scalar field whose name merely starts with the same letters', () => {
    expect(validateFieldVerifications([entry({ field: 'contactEmails' })])).toEqual([]);
    expect(isContactFieldPath('contactEmails')).toBe(false);
  });
});

describe('validateFieldVerifications — shape', () => {
  it('rejects a malformed verifiedAt', () => {
    for (const verifiedAt of ['2026-08-01', 'yesterday', '', '01/08/2026']) {
      const errors = validateFieldVerifications([entry({ verifiedAt })]);
      expect(errors.some((e) => e.includes('verifiedAt'))).toBe(true);
    }
  });

  it('rejects a non-http(s) sourceUrl but allows it to be absent', () => {
    expect(validateFieldVerifications([entry({ sourceUrl: 'ftp://x.example' })])
      .some((e) => e.includes('sourceUrl'))).toBe(true);
    expect(validateFieldVerifications([entry({ sourceUrl: 'https://club.example/contact' })])).toEqual([]);
    expect(validateFieldVerifications([entry()])).toEqual([]);
  });

  it('rejects a non-array and a non-object entry', () => {
    expect(validateFieldVerifications('nope')).toHaveLength(1);
    expect(validateFieldVerifications([null])).toHaveLength(1);
  });

  it('treats absent as valid — an existing lead has no provenance and that is correct', () => {
    expect(validateFieldVerifications(undefined)).toEqual([]);
    expect(validateFieldVerifications(null)).toEqual([]);
    expect(validateFieldVerifications([])).toEqual([]);
  });
});

describe('normalizeFieldVerifications — last-write-wins per (field, method)', () => {
  it('collapses a duplicate (field, method) to the newest verifiedAt', () => {
    const out = normalizeFieldVerifications([
      entry({ verifiedAt: at('2026-08-01T10:00:00.000Z'), sourceUrl: 'https://old.example' }),
      entry({ verifiedAt: at('2026-08-09T10:00:00.000Z'), sourceUrl: 'https://new.example' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].verifiedAt).toBe('2026-08-09T10:00:00.000Z');
    expect(out[0].sourceUrl).toBe('https://new.example');
  });

  it('keeps an older entry when the newer one arrives first — order in the payload does not decide', () => {
    const out = normalizeFieldVerifications([
      entry({ verifiedAt: at('2026-08-09T10:00:00.000Z') }),
      entry({ verifiedAt: at('2026-08-01T10:00:00.000Z') }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].verifiedAt).toBe('2026-08-09T10:00:00.000Z');
  });

  it('keeps both when the same field carries two different methods', () => {
    const out = normalizeFieldVerifications([
      entry({ field: 'general_contact', method: 'official' }),
      entry({ field: 'general_contact', method: 'phone' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('drops entries that could never be stored — bad method, bad timestamp, no field', () => {
    const out = normalizeFieldVerifications([
      entry(),
      entry({ field: 'notes', method: 'scraped' }),
      entry({ field: 'address', verifiedAt: 'yesterday' }),
      entry({ field: '   ' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].field).toBe('value_proposition');
  });

  it('omits sourceUrl and verifiedBy rather than storing empty strings', () => {
    const [out] = normalizeFieldVerifications([entry({ sourceUrl: '  ', verifiedBy: '' })]);
    expect(out).not.toHaveProperty('sourceUrl');
    expect(out).not.toHaveProperty('verifiedBy');
  });
});

describe('normalizeFieldVerifications — 60-entry cap, oldest evicted', () => {
  it('evicts the oldest when a 61st entry arrives', () => {
    const many = Array.from({ length: MAX_FIELD_VERIFICATIONS + 1 }, (_, i) =>
      entry({ field: `field_${i}`, verifiedAt: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }));
    const out = normalizeFieldVerifications(many);
    expect(out).toHaveLength(MAX_FIELD_VERIFICATIONS);
    // field_0 is the oldest and is the one that goes
    expect(out.some((e) => e.field === 'field_0')).toBe(false);
    expect(out.some((e) => e.field === `field_${MAX_FIELD_VERIFICATIONS}`)).toBe(true);
  });

  it('leaves an exactly-60 array untouched', () => {
    const many = Array.from({ length: MAX_FIELD_VERIFICATIONS }, (_, i) =>
      entry({ field: `field_${i}`, verifiedAt: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }));
    expect(normalizeFieldVerifications(many)).toHaveLength(MAX_FIELD_VERIFICATIONS);
  });

  it('does not count collapsed duplicates toward the cap', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      entry({ verifiedAt: `2026-06-01T10:00:${String(i % 60).padStart(2, '0')}.000Z` }));
    expect(normalizeFieldVerifications(many)).toHaveLength(1);
  });
});

describe('contact-level provenance survives the contact write path', () => {
  it('is not dropped by normalizeContact — it builds an explicit literal', () => {
    const c = normalizeContact({
      name: 'Jane Doe',
      phone: '5551234567',
      fieldVerifications: [entry({ field: 'phone', method: 'official' })],
    });
    expect(c.fieldVerifications).toHaveLength(1);
    expect(c.fieldVerifications?.[0].field).toBe('phone');
  });

  it('stays undefined for a contact that never carried it', () => {
    expect(normalizeContact({ name: 'Jane Doe' }).fieldVerifications).toBeUndefined();
  });

  it('merges rather than discards provenance when dedupeContacts collapses a duplicate', () => {
    const out = dedupeContacts([
      { name: 'Jane Doe', phone: '5551234567', fieldVerifications: [entry({ field: 'phone', method: 'official' })] },
      { name: 'Jane Doe', phone: '5551234567', fieldVerifications: [entry({ field: 'email', method: 'public', sourceUrl: 'https://dir.example' })] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].fieldVerifications?.map((e) => e.field).sort()).toEqual(['email', 'phone']);
  });
});

describe('validateLeadPayload wiring', () => {
  const base = {
    entity_name: 'Example Club',
    url: 'https://club.example',
    country: 'HU',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
  };

  it('rejects a lead whose fieldVerifications name a contact path', () => {
    const result = validateLeadPayload({ ...base, fieldVerifications: [entry({ field: 'contacts[0].phone' })] }, 'cogmap');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must not address a contact'))).toBe(true);
  });

  it('rejects an unknown method on a contact-level entry too', () => {
    const result = validateLeadPayload({
      ...base,
      contacts: [{ name: 'Jane Doe', fieldVerifications: [entry({ field: 'phone', method: 'scraped' })] }],
    }, 'cogmap');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('contacts[0].fieldVerifications[0].method'))).toBe(true);
  });

  it('accepts a well-formed lead carrying provenance at both scopes', () => {
    const result = validateLeadPayload({
      ...base,
      fieldVerifications: [entry({ field: 'value_proposition', method: 'ai_generated', verifiedBy: 'agent' })],
      contacts: [{ name: 'Jane Doe', fieldVerifications: [entry({ field: 'phone', method: 'official', sourceUrl: 'https://club.example/contact' })] }],
    }, 'cogmap');
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('still accepts a lead with no provenance at all', () => {
    expect(validateLeadPayload(base, 'cogmap').valid).toBe(true);
  });
});
