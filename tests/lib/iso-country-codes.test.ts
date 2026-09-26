import { describe, it, expect } from 'vitest';
import { ISO_COUNTRY_CODES, isValidIsoCountry, US_STATE_ISO_COLLISIONS } from '../../lib/iso-country-codes';

// Issues #222 / #223: a format-only country check let non-codes through.
describe('iso-country-codes', () => {
  it('holds exactly the 249 officially assigned codes plus the documented XK exception', () => {
    expect(ISO_COUNTRY_CODES.size).toBe(250);
    expect(ISO_COUNTRY_CODES.has('XK')).toBe(true);
  });

  it('accepts real codes, including ones that look like abbreviations of something else', () => {
    for (const c of ['GB', 'US', 'NA', 'SS', 'SO', 'NE', 'NO', 'TW', 'XK']) {
      expect(isValidIsoCountry(c), c).toBe(true);
    }
  });

  it('rejects the values the bad-data patterns actually produced', () => {
    for (const c of ['UK', 'EA', 'SP', 'LO', 'EU', 'ZZ', 'XX', 'USA', 'gb', '', null, undefined, 42]) {
      expect(isValidIsoCountry(c), String(c)).toBe(false);
    }
  });

  it('every US-state collision entry is itself a real ISO code', () => {
    for (const c of US_STATE_ISO_COLLISIONS) {
      expect(ISO_COUNTRY_CODES.has(c), c).toBe(true);
    }
    expect(US_STATE_ISO_COLLISIONS.has('DE')).toBe(true);
    expect(US_STATE_ISO_COLLISIONS.has('CA')).toBe(true);
    expect(US_STATE_ISO_COLLISIONS.has('GB')).toBe(false);
  });

  it('contains exactly every US state, DC and territory postal code that is also a country code', () => {
    const statesAndDc = ('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND ' +
      'OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC').split(' ');
    const territories = ['AS', 'GU', 'MP', 'PR', 'VI', 'FM', 'MH', 'PW'];
    expect(statesAndDc).toHaveLength(51);
    const expected = [...statesAndDc, ...territories].filter((c) => ISO_COUNTRY_CODES.has(c)).sort();
    expect([...US_STATE_ISO_COLLISIONS].sort()).toEqual(expected);
    expect(expected).toHaveLength(34);
    for (const c of ['TN', 'VA', 'AS', 'GU']) expect(US_STATE_ISO_COLLISIONS.has(c), c).toBe(true);
  });
});
