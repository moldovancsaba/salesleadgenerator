import { describe, it, expect } from 'vitest';
import { parseVCardString } from '../../lib/hostess-scan';

describe('parseVCardString', () => {
  it('parses standard vCard with FN, EMAIL, and TEL', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:John Smith',
      'EMAIL;TYPE=INTERNET:john.smith@example.com',
      'TEL;TYPE=CELL:+44 7123 456789',
      'ORG:Mr Vegas',
      'NOTE:Registered for Mr Vegas Grand Slam of Darts',
      'END:VCARD',
    ].join('\r\n');

    const parsed = parseVCardString(vcard);
    expect(parsed.name).toBe('John Smith');
    expect(parsed.email).toBe('john.smith@example.com');
    expect(parsed.phone).toBe('+44 7123 456789');
    expect(parsed.raw).toBe(vcard);
  });

  it('handles plain text email or json payload gracefully', () => {
    const rawEmail = 'jane.doe@example.co.uk';
    const parsed = parseVCardString(rawEmail);
    expect(parsed.email).toBe('jane.doe@example.co.uk');
  });

  it('handles JSON stringified attendee payload', () => {
    const jsonStr = JSON.stringify({
      name: 'Alice Wonder',
      email: 'alice@example.com',
      phone: '+123456789',
    });
    const parsed = parseVCardString(jsonStr);
    expect(parsed.name).toBe('Alice Wonder');
    expect(parsed.email).toBe('alice@example.com');
  });
});
