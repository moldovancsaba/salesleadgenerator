import { describe, it, expect } from 'vitest';
import { parseVCardString, isAttendeeBadge, scanFailureMessage } from '../../lib/hostess-scan';

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

describe('isAttendeeBadge', () => {
  it('accepts a vCard, a JSON card, a plain email and a plain phone number', () => {
    expect(isAttendeeBadge(parseVCardString('BEGIN:VCARD\nVERSION:3.0\nFN:John Smith\nEND:VCARD'))).toBe(true);
    expect(isAttendeeBadge(parseVCardString('{"name":"Jane Doe"}'))).toBe(true);
    expect(isAttendeeBadge(parseVCardString('jane.doe@example.co.uk'))).toBe(true);
    expect(isAttendeeBadge(parseVCardString('+44 7123 456789'))).toBe(true);
  });

  it('refuses a link or any other text that is not a badge', () => {
    expect(isAttendeeBadge(parseVCardString('https://example.com/poster'))).toBe(false);
    expect(isAttendeeBadge(parseVCardString('Tickets on sale now'))).toBe(false);
    expect(isAttendeeBadge(parseVCardString('BEGIN:VCARD\nVERSION:3.0\nEND:VCARD'))).toBe(false);
  });
});

describe('scanFailureMessage', () => {
  it('names the cause in words a hostess can act on', () => {
    expect(scanFailureMessage(0)).toMatch(/connection/i);
    expect(scanFailureMessage(422)).toMatch(/not an attendee badge/i);
    expect(scanFailureMessage(503)).toMatch(/unavailable/i);
    expect(scanFailureMessage(500)).toMatch(/our side/i);
    expect(scanFailureMessage(409, 'Custom server text')).toBe('Custom server text');
  });
});
