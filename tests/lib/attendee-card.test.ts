import { describe, it, expect } from 'vitest';
import { buildVCardString, buildCalendarIcsDataUri, AttendeeCardData } from '@/lib/attendee-card';

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
    expect(vCard).toContain('EMAIL:csaba@example.com');
    expect(vCard).toContain('TEL:+44 7123 456789');
    expect(vCard).toContain('ORG:Mr Vegas');
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

describe('attendee pass for any campaign', () => {
  const ics = (data: AttendeeCardData) => decodeURIComponent(buildCalendarIcsDataUri(data).split(',')[1]);

  it('names the organisation after the event when the brand label is missing, never after another client', () => {
    const vCard = buildVCardString({ name: 'Jane Doe', email: 'jane@example.com', eventName: 'Spring Expo 2027' });
    expect(vCard).toContain('ORG:Spring Expo 2027');
    expect(vCard).not.toMatch(/vegas/i);
  });

  it('writes the venue into the calendar entry only when the page has one', () => {
    const withVenue = ics({ name: 'Jane', eventName: 'Spring Expo', brandLabel: 'Acme', venue: 'Hall 4, Expo Centre' });
    expect(withVenue).toContain('LOCATION:Hall 4, Expo Centre');
    const without = ics({ name: 'Jane', eventName: 'Spring Expo', brandLabel: 'Acme' });
    expect(without).not.toContain('LOCATION:');
    expect(without).not.toMatch(/aldersley|wolverhampton|vegas/i);
  });
});
