import { describe, it, expect } from 'vitest';
import { findMatchingContactIndex } from '../../lib/contact-reply-matching';
import { normalizeContact } from '../../lib/contacts';

describe('findMatchingContactIndex', () => {
  it('returns -1 for empty contacts array', () => {
    expect(findMatchingContactIndex([], 'david|david@example.com')).toBe(-1);
  });

  it('matches exact contactKey when contact has not changed', () => {
    const contacts = [
      normalizeContact({ name: 'Dávid', email: 'david@example.com' }),
    ];
    const idx = findMatchingContactIndex(contacts, 'dávid|david@example.com');
    expect(idx).toBe(0);
  });

  it('matches by email when contact name drifted after suggestion creation (e.g. Dávid -> Dávid Bozsik)', () => {
    const contacts = [
      normalizeContact({ name: 'John Doe', email: 'john@example.com' }),
      normalizeContact({ name: 'Dávid Bozsik', email: 'david.bozsik@seyuselfies.com' }),
    ];
    // Suggestion was generated with key "dávid|david.bozsik@seyuselfies.com"
    const idx = findMatchingContactIndex(
      contacts,
      'dávid|david.bozsik@seyuselfies.com',
      { name: 'Dávid', title: 'CEO' }
    );
    expect(idx).toBe(1);
    expect(contacts[idx].name).toBe('Dávid Bozsik');
  });

  it('matches by phone digits when key contains a phone number and name drifted', () => {
    const contacts = [
      normalizeContact({ name: 'Alex M. Chen', phone: '+1 (555) 987-6543' }),
      normalizeContact({ name: 'Sarah Connor', phone: '+1 (555) 123-4567' }),
    ];
    const idx = findMatchingContactIndex(
      contacts,
      'alex chen|+15559876543',
      { name: 'Alex Chen' }
    );
    expect(idx).toBe(0);
  });

  it('matches by name tokens when key only has a name or email/phone are absent', () => {
    const contacts = [
      normalizeContact({ name: 'Dávid Bozsik' }),
      normalizeContact({ name: 'Gergő Szabó' }),
    ];
    const idx = findMatchingContactIndex(
      contacts,
      'dávid',
      { name: 'Dávid' }
    );
    expect(idx).toBe(0);
  });

  it('falls back to the single contact if the lead only has one contact', () => {
    const contacts = [
      normalizeContact({ name: 'Renamed Founder', email: 'founder@newdomain.com' }),
    ];
    // Historical suggestion from an old email
    const idx = findMatchingContactIndex(
      contacts,
      'founder|old@previous.com',
      { name: 'Founder' }
    );
    expect(idx).toBe(0);
  });

  it('returns -1 when contact was removed from a multi-contact lead', () => {
    const contacts = [
      normalizeContact({ name: 'Alice Smith', email: 'alice@example.com' }),
      normalizeContact({ name: 'Bob Jones', email: 'bob@example.com' }),
    ];
    const idx = findMatchingContactIndex(
      contacts,
      'charlie brown|charlie@example.com',
      { name: 'Charlie Brown' }
    );
    expect(idx).toBe(-1);
  });
});
