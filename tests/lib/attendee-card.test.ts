import { describe, it, expect } from 'vitest';
import { buildVCardString, AttendeeCardData } from '@/lib/attendee-card';

describe('attendee-card vCard builder', () => {
  it('generates standard vCard 3.0 string with name, email, phone and location', () => {
    const data: AttendeeCardData = {
      name: 'Csaba Moldovan',
      email: 'csaba@example.com',
      phone: '+44 7123 456789',
      country: 'United Kingdom',
      postCode: 'WV6 9NW',
      eventName: 'Mr Vegas Grand Slam of Darts',
      brandLabel: 'Mr Vegas',
    };

    const vCard = buildVCardString(data);
    expect(vCard).toContain('BEGIN:VCARD');
    expect(vCard).toContain('VERSION:3.0');
    expect(vCard).toContain('FN:Csaba Moldovan');
    expect(vCard).toContain('EMAIL;TYPE=INTERNET:csaba@example.com');
    expect(vCard).toContain('TEL;TYPE=CELL:+44 7123 456789');
    expect(vCard).toContain('ADR;TYPE=HOME:;;;WV6 9NW;;United Kingdom');
    expect(vCard).toContain('ORG:Mr Vegas');
    expect(vCard).toContain('NOTE:Registered for Mr Vegas Grand Slam of Darts');
    expect(vCard).toContain('END:VCARD');
  });

  it('handles partial attendee data gracefully', () => {
    const data: AttendeeCardData = {
      name: 'Jane Doe',
      eventName: 'Vegas Event',
    };

    const vCard = buildVCardString(data);
    expect(vCard).toContain('FN:Jane Doe');
    expect(vCard).not.toContain('EMAIL');
    expect(vCard).not.toContain('TEL');
    expect(vCard).toContain('END:VCARD');
  });
});
