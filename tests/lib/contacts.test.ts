import { describe, it, expect } from 'vitest';
import { normalizeContact, dedupeContacts, getDecisionMakerContact, normalizePhone, normalizeEmail } from '../../lib/contacts';

describe('normalizeContact', () => {
  it('trims fields and formats email/phone', () => {
    const c = normalizeContact({ name: '  Jane Doe  ', email: 'JANE@Example.com ', phone: ' 5551234567 ' });
    expect(c.name).toBe('Jane Doe');
    expect(c.email).toBe('jane@example.com');
    expect(c.phone).toBe('+15551234567');
  });

  it('defaults isDecisionMaker to false unless explicitly true', () => {
    expect(normalizeContact({ name: 'A' }).isDecisionMaker).toBe(false);
    expect(normalizeContact({ name: 'A', isDecisionMaker: 'yes' }).isDecisionMaker).toBe(false);
    expect(normalizeContact({ name: 'A', isDecisionMaker: true }).isDecisionMaker).toBe(true);
  });

  it('tolerates non-string/missing fields without throwing', () => {
    expect(() => normalizeContact({})).not.toThrow();
    expect(() => normalizeContact(null as any)).not.toThrow();
    const c = normalizeContact(null as any);
    expect(c.name).toBe('');
  });
});

describe('dedupeContacts', () => {
  it('returns [] for non-array input', () => {
    expect(dedupeContacts(undefined)).toEqual([]);
    expect(dedupeContacts(null)).toEqual([]);
    expect(dedupeContacts('not an array' as any)).toEqual([]);
  });

  it('drops entries with no name, email, or phone', () => {
    const result = dedupeContacts([{ title: 'CEO' }, { name: 'Real Contact' }]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Real Contact');
  });

  it('dedupes by name+phone first, falling back to name+email, then bare name', () => {
    const result = dedupeContacts([
      { name: 'Jane', phone: '+15551234567', email: 'jane@a.com' },
      { name: 'Jane', phone: '+15551234567', email: 'different@a.com' }, // same name+phone -> dropped
      { name: 'Jane', email: 'jane@b.com' }, // different key (no phone) -> kept
      { name: 'Bob' },
      { name: 'Bob' }, // bare-name dup -> dropped
    ]);
    expect(result).toHaveLength(3);
  });

  it('preserves isDecisionMaker through dedup', () => {
    const result = dedupeContacts([{ name: 'Jane', email: 'jane@a.com', isDecisionMaker: true }]);
    expect(result[0].isDecisionMaker).toBe(true);
  });
});

describe('getDecisionMakerContact', () => {
  it('returns null when no contact is flagged', () => {
    expect(getDecisionMakerContact([{ name: 'Jane' }])).toBeNull();
    expect(getDecisionMakerContact(undefined)).toBeNull();
  });

  it('returns the flagged contact, normalized', () => {
    const dm = getDecisionMakerContact([
      { name: 'Jane', isDecisionMaker: false },
      { name: 'Bob', email: 'BOB@EXAMPLE.COM', isDecisionMaker: true },
    ]);
    expect(dm?.name).toBe('Bob');
    expect(dm?.email).toBe('bob@example.com');
  });

  it('returns the first flagged contact when multiple are flagged', () => {
    const dm = getDecisionMakerContact([
      { name: 'First', isDecisionMaker: true },
      { name: 'Second', isDecisionMaker: true },
    ]);
    expect(dm?.name).toBe('First');
  });
});

describe('normalizePhone', () => {
  it('assumes US for a bare 10-digit number', () => {
    expect(normalizePhone('5551234567')).toBe('+15551234567');
  });

  it('leaves an already-international number untouched', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail(' JOHN@Example.com ')).toBe('john@example.com');
  });
});
