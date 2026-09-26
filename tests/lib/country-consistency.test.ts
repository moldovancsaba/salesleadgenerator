import { describe, it, expect } from 'vitest';
import { checkCountryConsistency } from '../../lib/country-consistency';

// Issue #222. Cases mirror the real shapes recorded on the issue.
describe('checkCountryConsistency', () => {
  it('flags a stored country the address contradicts by name (the Seyu DE pattern)', () => {
    expect(checkCountryConsistency({ country: 'DE', address: 'Filbert Way, Leicester, United Kingdom' }))
      .toMatchObject({ reason: 'mismatch', evidenceCode: 'GB' });
    expect(checkCountryConsistency({ country: 'DE', address: 'Alcañiz, Teruel, Spain' }))
      .toMatchObject({ reason: 'mismatch', evidenceCode: 'ES' });
  });

  it('reads common aliases and diacritics (UK, England, España)', () => {
    expect(checkCountryConsistency({ country: 'DE', address: 'Nottingham, UK' })).toMatchObject({ reason: 'mismatch', evidenceCode: 'GB' });
    expect(checkCountryConsistency({ country: 'GB', address: 'Glasgow, Scotland' }).reason).toBe('consistent');
    expect(checkCountryConsistency({ country: 'ES', address: 'Madrid, España' }).reason).toBe('consistent');
  });

  it('treats a genuine match as consistent (FC Bayern is really DE)', () => {
    expect(checkCountryConsistency({ country: 'DE', address: 'Säbener Str. 51, 81547 München, Germany' }).reason).toBe('consistent');
  });

  it('checks a country name even when a code was echoed after it', () => {
    expect(checkCountryConsistency({ country: 'DE', address: 'Marseille, France, DE' })).toMatchObject({ reason: 'mismatch', evidenceCode: 'FR' });
  });

  it('never counts a tail equal to the stored code as confirmation (create-time echo)', () => {
    expect(checkCountryConsistency({ country: 'NL', address: 'Van Zandvlietplein 1, Rotterdam, NL' }).reason).toBe('echo-only');
  });

  it('accepts a US state tail for a US lead, including with a ZIP code', () => {
    expect(checkCountryConsistency({ country: 'US', address: '1265 Lombardi Ave, Green Bay, WI 54304' }).reason).toBe('consistent');
    expect(checkCountryConsistency({ country: 'US', address: 'Nashville, TN' }).reason).toBe('consistent');
  });

  it('treats a state-like tail on a non-US lead as ambiguous, not as a country', () => {
    expect(checkCountryConsistency({ country: 'GB', address: 'Wilmington, DE' }).reason).toBe('ambiguous-tail');
  });

  it('marks a different, non-state country-code tail as weak evidence', () => {
    expect(checkCountryConsistency({ country: 'DE', address: 'Alvalade, Lisboa, PT' })).toMatchObject({ reason: 'tail-code-differs', evidenceCode: 'PT' });
  });

  it('does not read the US state Georgia as the country for a US lead', () => {
    expect(checkCountryConsistency({ country: 'US', address: 'Atlanta, Georgia' }).reason).toBe('consistent');
  });

  it('reports missing, invalid, no-address and no-evidence separately', () => {
    expect(checkCountryConsistency({ country: '', address: 'Paris, France' }).reason).toBe('missing');
    expect(checkCountryConsistency({ country: 'XX', address: 'Paris, France' }).reason).toBe('invalid-code');
    expect(checkCountryConsistency({ country: 'FR' }).reason).toBe('no-address');
    expect(checkCountryConsistency({ country: 'FR', address: '12 Rue de Rivoli' }).reason).toBe('no-evidence');
  });

  it('accepts Kosovo (XK), which is outside ISO 3166-1 but used for real leads', () => {
    expect(checkCountryConsistency({ country: 'XK', address: 'Pristina, Kosovo' }).reason).toBe('consistent');
  });
});
