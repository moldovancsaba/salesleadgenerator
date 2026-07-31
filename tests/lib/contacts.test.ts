import { describe, it, expect } from 'vitest';
import { normalizeContact, dedupeContacts, getDecisionMakerContact, normalizePhone, normalizeEmail, contactKey, verifiableFieldsDiffer, toNameCase, aggregateContactsAcrossLeads } from '../../lib/contacts';

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

  it('decodes stray HTML-entity artifacts in name/title/role (issue #132, the loop\'s single most frequent real mistake)', () => {
    const c = normalizeContact({ name: 'Bed &amp; Breakfast Owner', title: 'Owner &amp; General Manager', role: 'Communications &amp; Marketing Director' });
    expect(c.name).toBe('Bed & Breakfast Owner');
    expect(c.title).toBe('Owner & General Manager');
    expect(c.role).toBe('Communications & Marketing Director');
  });

  it('tolerates non-string/missing fields without throwing', () => {
    expect(() => normalizeContact({})).not.toThrow();
    expect(() => normalizeContact(null as any)).not.toThrow();
    const c = normalizeContact(null as any);
    expect(c.name).toBe('');
  });

  it('derives seniorityTier/department from title on every normalize (issue #68)', () => {
    const c = normalizeContact({ name: 'A', title: 'VP of Sales' });
    expect(c.seniorityTier).toBe('VP');
    expect(c.department).toBe('Sales');
  });

  it('re-derives seniorityTier/department rather than trusting an input-supplied value', () => {
    // Unlike emailVerificationStatus (server-computed, passed through), these
    // are always re-derived from title — a caller can't spoof them by
    // sending stale/fabricated values in the payload.
    const c = normalizeContact({ name: 'A', title: 'Sales Manager', seniorityTier: 'C-level', department: 'Executive' } as any);
    expect(c.seniorityTier).toBe('Manager');
    expect(c.department).toBe('Sales');
  });

  it('resolves an empty/missing title to Unknown/Unknown', () => {
    const c = normalizeContact({ name: 'A' });
    expect(c.seniorityTier).toBe('Unknown');
    expect(c.department).toBe('Unknown');
  });
});

describe('toNameCase (issue #96)', () => {
  it('title-cases all-caps input', () => {
    expect(toNameCase('JOHN SMITH')).toBe('John Smith');
  });

  it('title-cases all-lowercase input', () => {
    expect(toNameCase('john smith')).toBe('John Smith');
  });

  it('capitalizes after a hyphen', () => {
    expect(toNameCase('anne-marie dubois')).toBe('Anne-Marie Dubois');
  });

  it('capitalizes after an apostrophe', () => {
    expect(toNameCase("o'brien")).toBe("O'Brien");
    expect(toNameCase("d'angelo")).toBe("D'Angelo");
  });

  it('returns empty string for empty input', () => {
    expect(toNameCase('')).toBe('');
  });

  it('leaves already-correct Title Case unchanged', () => {
    expect(toNameCase('Jane Doe')).toBe('Jane Doe');
  });

  it('documented v1 limitation: flattens Mc/Mac-style prefixes', () => {
    expect(toNameCase('McDonald')).toBe('Mcdonald');
  });
});

describe('normalizeContact — name casing (issue #96)', () => {
  it('title-cases a contact name on every normalize', () => {
    expect(normalizeContact({ name: 'JOHN SMITH' }).name).toBe('John Smith');
    expect(normalizeContact({ name: 'john smith' }).name).toBe('John Smith');
  });
});

describe('normalizeContact — lastVerifiedAt stamping', () => {
  it('leaves lastVerifiedAt undefined by default when the input has none', () => {
    expect(normalizeContact({ name: 'A' }).lastVerifiedAt).toBeUndefined();
  });

  it('passes through the input lastVerifiedAt unchanged when verify is not set', () => {
    const c = normalizeContact({ name: 'A', lastVerifiedAt: '2026-01-01T00:00:00.000Z' });
    expect(c.lastVerifiedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('stamps lastVerifiedAt to the supplied now when verify is true, overriding any input value', () => {
    const now = new Date('2026-07-25T00:00:00.000Z');
    const c = normalizeContact({ name: 'A', lastVerifiedAt: '2020-01-01T00:00:00.000Z' }, { verify: true, now });
    expect(c.lastVerifiedAt).toBe('2026-07-25T00:00:00.000Z');
  });
});

describe('contactKey', () => {
  it('matches lib/contacts.ts dedup key precedence (name+phone, then name+email, then bare name)', () => {
    const a = normalizeContact({ name: 'Jane', phone: '+15551234567' });
    const b = normalizeContact({ name: 'Jane', phone: '+15551234567' });
    expect(contactKey(a)).toBe(contactKey(b));
  });

  it('returns empty string for a contact with no name', () => {
    expect(contactKey(normalizeContact({ email: 'a@b.com' }))).toBe('');
  });
});

describe('verifiableFieldsDiffer', () => {
  it('returns true when there is no prior match', () => {
    expect(verifiableFieldsDiffer(null, normalizeContact({ name: 'A', email: 'a@b.com' }))).toBe(true);
  });

  it('returns false when verifiable fields are identical', () => {
    const a = normalizeContact({ name: 'A', email: 'a@b.com', title: 'CEO' });
    const b = normalizeContact({ name: 'A', email: 'a@b.com', title: 'CEO' });
    expect(verifiableFieldsDiffer(a, b)).toBe(false);
  });

  it('returns true when a verifiable field changed', () => {
    const a = normalizeContact({ name: 'A', email: 'a@b.com', title: 'CEO' });
    const b = normalizeContact({ name: 'A', email: 'a@b.com', title: 'CTO' });
    expect(verifiableFieldsDiffer(a, b)).toBe(true);
  });

  it('ignores name/isDecisionMaker changes (not verifiable fields)', () => {
    const a = normalizeContact({ name: 'A', email: 'a@b.com', isDecisionMaker: false });
    const b = normalizeContact({ name: 'A', email: 'a@b.com', isDecisionMaker: true });
    expect(verifiableFieldsDiffer(a, b)).toBe(false);
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

  it('on collision, keeps the later of the two lastVerifiedAt timestamps regardless of order', () => {
    const laterFirst = dedupeContacts([
      { name: 'Jane', phone: '+15551234567', lastVerifiedAt: '2026-06-01T00:00:00.000Z' },
      { name: 'Jane', phone: '+15551234567', lastVerifiedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(laterFirst).toHaveLength(1);
    expect(laterFirst[0].lastVerifiedAt).toBe('2026-06-01T00:00:00.000Z');

    const earlierFirst = dedupeContacts([
      { name: 'Jane', phone: '+15551234567', lastVerifiedAt: '2026-01-01T00:00:00.000Z' },
      { name: 'Jane', phone: '+15551234567', lastVerifiedAt: '2026-06-01T00:00:00.000Z' },
    ]);
    expect(earlierFirst[0].lastVerifiedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('forwards verify/now options to every normalized contact', () => {
    const now = new Date('2026-07-25T00:00:00.000Z');
    const result = dedupeContacts(
      [{ name: 'Jane', lastVerifiedAt: '2020-01-01T00:00:00.000Z' }],
      { verify: true, now }
    );
    expect(result[0].lastVerifiedAt).toBe('2026-07-25T00:00:00.000Z');
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

  // Issue #133 — extension notation was silently fusing into the subscriber
  // number ("+1-804-823-9191 ext. 5" -> the real, wrong "+180482391915").
  // Every notation below must now truncate at the marker, never fuse.
  describe('extension notation (issue #133)', () => {
    it('drops "ext. N" — the exact real-world corruption case', () => {
      expect(normalizePhone('+1-804-823-9191 ext. 5')).toBe('+18048239191');
    });

    it('drops "ext N" (no period)', () => {
      expect(normalizePhone('+1-804-823-9191 ext 4')).toBe('+18048239191');
    });

    it('drops "extension N" (spelled out)', () => {
      expect(normalizePhone('+1-804-823-9191 extension 10')).toBe('+18048239191');
    });

    it('drops "extN" with no separator at all', () => {
      expect(normalizePhone('+18048239191ext5')).toBe('+18048239191');
    });

    it('drops "xN" appended directly with no space — a real business-card convention', () => {
      expect(normalizePhone('5551234567x54')).toBe('+15551234567');
    });

    it('drops "x N" with a space', () => {
      expect(normalizePhone('555-123-4567 x 54')).toBe('+15551234567');
    });

    it('drops "#N"', () => {
      expect(normalizePhone('555-123-4567#54')).toBe('+15551234567');
    });

    it('drops ",N" (comma-pause notation)', () => {
      expect(normalizePhone('555-123-4567,54')).toBe('+15551234567');
    });

    it('does not treat "x"/"ext" inside an ordinary word as an extension marker', () => {
      // "extra54" contains neither "ext" immediately followed by digits nor
      // a standalone "x" followed by digits (the "x" in "extra" is preceded
      // by the letter "e", failing the marker's lookbehind guard) — so
      // nothing is truncated, proving the matcher doesn't fire inside a
      // word. All digits survive, digit-stripped and +-prefixed as normal.
      expect(normalizePhone('extra54')).toBe('+54');
    });

    it('returns an empty string rather than a bare "+" when nothing but an extension remains', () => {
      expect(normalizePhone('ext. 5')).toBe('');
    });
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail(' JOHN@Example.com ')).toBe('john@example.com');
  });
});

describe('aggregateContactsAcrossLeads (issue #139)', () => {
  it('groups the same contact (by contactKey) across two leads into one entry with both leads attached', () => {
    const result = aggregateContactsAcrossLeads([
      { _id: 'lead-1', entity_name: 'Acme FC', contacts: [{ name: 'Jane Doe', phone: '5551234567', isDecisionMaker: true }] },
      { _id: 'lead-2', entity_name: 'Acme Agency', contacts: [{ name: 'Jane Doe', phone: '5551234567' }] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].leads).toEqual([
      { leadId: 'lead-1', entity_name: 'Acme FC' },
      { leadId: 'lead-2', entity_name: 'Acme Agency' },
    ]);
  });

  it('keeps two different people with only a shared name as separate entries', () => {
    const result = aggregateContactsAcrossLeads([
      { _id: 'lead-1', entity_name: 'Team A', contacts: [{ name: 'Jane Doe', email: 'jane@team-a.com' }] },
      { _id: 'lead-2', entity_name: 'Team B', contacts: [{ name: 'Jane Doe', email: 'jane@team-b.com' }] },
    ]);
    expect(result).toHaveLength(2);
  });

  it('excludes nameless contacts (no key to group or search by)', () => {
    const result = aggregateContactsAcrossLeads([
      { _id: 'lead-1', entity_name: 'Team A', contacts: [{ email: 'noname@team-a.com' }] },
    ]);
    expect(result).toHaveLength(0);
  });

  it('does not duplicate the same lead twice on one entry when a lead lists the same contact more than once', () => {
    const result = aggregateContactsAcrossLeads([
      { _id: 'lead-1', entity_name: 'Team A', contacts: [
        { name: 'Jane Doe', phone: '5551234567' },
        { name: 'Jane Doe', phone: '5551234567' },
      ] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].leads).toHaveLength(1);
  });

  it('sorts entries by name', () => {
    const result = aggregateContactsAcrossLeads([
      { _id: 'lead-1', entity_name: 'Team A', contacts: [{ name: 'Zoe', email: 'z@a.com' }] },
      { _id: 'lead-2', entity_name: 'Team B', contacts: [{ name: 'Amy', email: 'a@b.com' }] },
    ]);
    expect(result.map((c) => c.name)).toEqual(['Amy', 'Zoe']);
  });

  it('returns [] for an empty lead list', () => {
    expect(aggregateContactsAcrossLeads([])).toEqual([]);
  });
});
