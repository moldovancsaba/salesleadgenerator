import { describe, it, expect } from 'vitest';
import { parseVCardString, isAttendeeBadge, scanFailureMessage, checkInAdvancesColumn, columnLabel } from '../../lib/hostess-scan';
import { accessCodeLockedOut, accessCodeMatches, clearAccessCodeFailures, recordAccessCodeFailure, scannerAccessCode } from '../../lib/hostess-scan-server';

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
    expect(scanFailureMessage(404)).toMatch(/no attendee matches/i);
    expect(scanFailureMessage(503)).toMatch(/unavailable/i);
    expect(scanFailureMessage(500)).toMatch(/our side/i);
    expect(scanFailureMessage(409, 'Custom server text')).toBe('Custom server text');
  });
});

describe('checkInAdvancesColumn', () => {
  it('moves a lead forward, never back, and lifts parked or lost leads', () => {
    expect(checkInAdvancesColumn('DISCOVERED', 'ENGAGED')).toBe(true);
    expect(checkInAdvancesColumn('QUALIFIED', 'ENGAGED')).toBe(true);
    expect(checkInAdvancesColumn('ENGAGED', 'ENGAGED')).toBe(false);
    expect(checkInAdvancesColumn('PROPOSAL', 'ENGAGED')).toBe(false);
    expect(checkInAdvancesColumn('WON', 'QUALIFIED')).toBe(false);
    expect(checkInAdvancesColumn('LOST', 'ENGAGED')).toBe(true);
    expect(checkInAdvancesColumn('BACKLOG', 'QUALIFIED')).toBe(true);
    expect(checkInAdvancesColumn(undefined, 'DISCOVERED')).toBe(true);
  });

  it('names columns the way people read them', () => {
    expect(columnLabel('ENGAGED')).toBe('Engaged');
    expect(columnLabel('PROPOSAL')).toBe('Proposal');
  });
});

describe('scanner access code', () => {
  it('uses the page code, else the shared deployment code, else none', () => {
    expect(scannerAccessCode('page-code', { HOSTESS_SCAN_PASSWORD: 'shared' })).toBe('page-code');
    expect(scannerAccessCode('  ', { HOSTESS_SCAN_PASSWORD: ' shared ' })).toBe('shared');
    expect(scannerAccessCode(undefined, {})).toBeNull();
  });

  it('compares codes exactly and treats a missing guess as wrong', () => {
    expect(accessCodeMatches('door-code', 'door-code')).toBe(true);
    expect(accessCodeMatches('door-code', ' door-code ')).toBe(true);
    expect(accessCodeMatches('door-code', 'door-cod')).toBe(false);
    expect(accessCodeMatches('door-code', 'DOOR-CODE')).toBe(false);
    expect(accessCodeMatches('door-code', undefined)).toBe(false);
    expect(accessCodeMatches('door-code', '')).toBe(false);
  });

  it('locks out after eight wrong codes and lets a caller back in after the window', () => {
    const key = 'brand:page:198.51.100.1';
    const start = 1_000_000;
    for (let i = 0; i < 7; i++) recordAccessCodeFailure(key, start + i);
    expect(accessCodeLockedOut(key, start + 10)).toBe(false);
    recordAccessCodeFailure(key, start + 8);
    expect(accessCodeLockedOut(key, start + 10)).toBe(true);
    expect(accessCodeLockedOut(key, start + 6 * 60 * 1000)).toBe(false);
    recordAccessCodeFailure(key, start + 6 * 60 * 1000 + 1);
    clearAccessCodeFailures(key);
    expect(accessCodeLockedOut(key, start + 6 * 60 * 1000 + 2)).toBe(false);
  });
});
