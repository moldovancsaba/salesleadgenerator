import { describe, it, expect } from 'vitest';
import {
  normalizeContact,
  dedupeContacts,
  deriveContactEmails,
  getContactSendEmail,
  aggregateContactsAcrossLeads,
  isValidContactCRMStatus,
} from '../../lib/contacts';

describe('Contact Foundation — Extended Fields & Normalization (issue 241)', () => {
  it('derives firstName and lastName from contact name if not provided', () => {
    const c = normalizeContact({ name: 'Ada Lovelace' });
    expect(c.name).toBe('Ada Lovelace');
    expect(c.firstName).toBe('Ada');
    expect(c.lastName).toBe('Lovelace');
  });

  it('preserves and title-cases explicitly provided firstName and lastName', () => {
    const c = normalizeContact({ name: 'Ada Lovelace', firstName: 'ADA', lastName: 'BYRON' });
    expect(c.firstName).toBe('Ada');
    expect(c.lastName).toBe('Byron');
  });

  it('normalizes secondaryEmail and lowercases it', () => {
    const c = normalizeContact({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      secondaryEmail: ' ADA.SECONDARY@Domain.ORG  ',
    });
    expect(c.email).toBe('ada@example.com');
    expect(c.secondaryEmail).toBe('ada.secondary@domain.org');
  });

  it('drops secondaryEmail if it is identical to primary email', () => {
    const c = normalizeContact({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      secondaryEmail: 'ADA@example.com',
    });
    expect(c.email).toBe('ada@example.com');
    expect(c.secondaryEmail).toBeUndefined();
  });

  it('defaults crmStatus to prospect and validates allowed statuses', () => {
    expect(isValidContactCRMStatus('prospect')).toBe(true);
    expect(isValidContactCRMStatus('customer')).toBe(true);
    expect(isValidContactCRMStatus('invalid_status')).toBe(false);

    const defaultContact = normalizeContact({ name: 'Ada Lovelace' });
    expect(defaultContact.crmStatus).toBe('prospect');

    const customerContact = normalizeContact({ name: 'Ada Lovelace', crmStatus: 'customer' });
    expect(customerContact.crmStatus).toBe('customer');

    const invalidContact = normalizeContact({ name: 'Ada Lovelace', crmStatus: 'not_a_status' });
    expect(invalidContact.crmStatus).toBe('prospect');
  });

  it('normalizes ownerUserId and customFields', () => {
    const c = normalizeContact({
      name: 'Ada Lovelace',
      ownerUserId: '  user_rep_123  ',
      customFields: {
        budget: '$50,000',
        referral: 'conference',
      },
    });
    expect(c.ownerUserId).toBe('user_rep_123');
    expect(c.customFields).toEqual({
      budget: '$50,000',
      referral: 'conference',
    });
  });
});

describe('Send Safety Invariant — getContactSendEmail (issue 241)', () => {
  it('returns strictly primary email and never secondary email for send dispatch', () => {
    const contact = normalizeContact({
      name: 'Ada Lovelace',
      email: 'ada.primary@example.com',
      secondaryEmail: 'ada.alt@example.com',
    });

    const sendTarget = getContactSendEmail(contact);
    expect(sendTarget).toBe('ada.primary@example.com');
    expect(sendTarget).not.toBe('ada.alt@example.com');
  });

  it('returns null if primary email is missing', () => {
    const contact = normalizeContact({
      name: 'Ada Lovelace',
      secondaryEmail: 'ada.alt@example.com',
    });
    expect(getContactSendEmail(contact)).toBeNull();
  });
});

describe('deriveContactEmails — Inbound attribution (issue 241)', () => {
  it('indexes both primary and secondary emails for inbound reply and webhook matching', () => {
    const contacts = [
      normalizeContact({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        secondaryEmail: 'ada.alt@example.com',
      }),
      normalizeContact({
        name: 'Charles Babbage',
        email: 'charles@example.com',
      }),
    ];

    const indexed = deriveContactEmails(contacts);
    expect(indexed).toContain('ada@example.com');
    expect(indexed).toContain('ada.alt@example.com');
    expect(indexed).toContain('charles@example.com');
    expect(indexed.length).toBe(3);
  });
});

describe('dedupeContacts with extended fields (issue 241)', () => {
  it('merges secondaryEmail, crmStatus, ownerUserId, and customFields on collision', () => {
    const contacts = [
      {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        crmStatus: 'prospect',
      },
      {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        secondaryEmail: 'ada.backup@example.com',
        crmStatus: 'customer',
        ownerUserId: 'rep_1',
        customFields: { tier: 'gold' },
      },
    ];

    const deduped = dedupeContacts(contacts);
    expect(deduped.length).toBe(1);
    expect(deduped[0].email).toBe('ada@example.com');
    expect(deduped[0].secondaryEmail).toBe('ada.backup@example.com');
    expect(deduped[0].crmStatus).toBe('customer');
    expect(deduped[0].ownerUserId).toBe('rep_1');
    expect(deduped[0].customFields).toEqual({ tier: 'gold' });
  });
});

describe('aggregateContactsAcrossLeads (issue 241)', () => {
  it('includes secondaryEmail, crmStatus, ownerUserId, and customFields in directory entries', () => {
    const leads = [
      {
        _id: 'lead-1',
        entity_name: 'Acme Corp',
        contacts: [
          {
            name: 'Ada Lovelace',
            email: 'ada@acme.com',
            secondaryEmail: 'ada.personal@gmail.com',
            crmStatus: 'active',
            ownerUserId: 'user-1',
            customFields: { region: 'EMEA' },
          },
        ],
      },
    ];

    const dir = aggregateContactsAcrossLeads(leads);
    expect(dir.length).toBe(1);
    expect(dir[0].name).toBe('Ada Lovelace');
    expect(dir[0].firstName).toBe('Ada');
    expect(dir[0].lastName).toBe('Lovelace');
    expect(dir[0].email).toBe('ada@acme.com');
    expect(dir[0].secondaryEmail).toBe('ada.personal@gmail.com');
    expect(dir[0].crmStatus).toBe('active');
    expect(dir[0].ownerUserId).toBe('user-1');
    expect(dir[0].customFields).toEqual({ region: 'EMEA' });
    expect(dir[0].leads).toEqual([{ leadId: 'lead-1', entity_name: 'Acme Corp' }]);
  });
});
