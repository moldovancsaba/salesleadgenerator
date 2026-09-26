import { ISO_COUNTRY_CODES, isValidIsoCountry, US_STATE_ISO_COLLISIONS } from './iso-country-codes';

// Issue #222: classifies whether a lead's stored `country` agrees with its
// own `address`, for a read-only server-side scan (GET
// /api/admin/data-hygiene/country). Conservative by design — see the
// constraints recorded on #222:
// - A bare two-letter address tail is never proof on its own. US states,
//   Canadian provinces, Australian and Brazilian states reuse country codes.
// - On create, normalizeAddress appends the submitted country code to the
//   address, so a tail equal to the stored country may be an echo of the
//   wrong value, not a confirmation.
// - Only a full country name in the address counts as strong evidence.

export type CountryCheckReason =
  | 'consistent'        // address names the stored country (or a US state for US)
  | 'mismatch'          // address names a different country — strong evidence
  | 'tail-code-differs' // address ends in a different, non-state country code — weak evidence
  | 'echo-only'         // only evidence is a tail equal to the stored code
  | 'ambiguous-tail'    // tail is a code that is also a US state/territory
  | 'no-evidence'       // address present but names no country
  | 'no-address'
  | 'invalid-code'      // stored country is not an ISO 3166-1 alpha-2 code (or XK)
  | 'missing';          // no stored country

export const ANOMALY_REASONS: ReadonlySet<CountryCheckReason> = new Set(['mismatch', 'tail-code-differs', 'invalid-code', 'missing']);

export type CountryCheck = { reason: CountryCheckReason; evidenceCode?: string; evidence?: string };

const US_STATES_AND_DC: ReadonlySet<string> = new Set(
  ('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND ' +
    'OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC').split(' ')
);

// Common English forms Intl.DisplayNames doesn't produce. England, Scotland,
// Wales and Northern Ireland are GB in ISO 3166-1.
const NAME_ALIASES: Record<string, string> = {
  'usa': 'US', 'u.s.a.': 'US', 'united states of america': 'US', 'america': 'US',
  'uk': 'GB', 'u.k.': 'GB', 'great britain': 'GB', 'britain': 'GB',
  'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
  'uae': 'AE', 'holland': 'NL', 'the netherlands': 'NL', 'czech republic': 'CZ',
  'korea': 'KR', 'republic of korea': 'KR', 'turkey': 'TR', 'russia': 'RU',
  'ivory coast': 'CI', "cote d'ivoire": 'CI', 'vatican': 'VA', 'macedonia': 'MK',
  'deutschland': 'DE', 'espana': 'ES', 'italia': 'IT', 'brasil': 'BR', 'schweiz': 'CH',
  'osterreich': 'AT', 'polska': 'PL', 'magyarorszag': 'HU', 'nederland': 'NL',
};

// Names that are also US state names — only counted as a country when the
// stored country isn't US.
const US_STATE_NAME_COLLISIONS: ReadonlySet<string> = new Set(['georgia']);

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

let nameIndex: Map<string, string> | null = null;
function countryNameIndex(): Map<string, string> {
  if (nameIndex) return nameIndex;
  const index = new Map<string, string>();
  const display = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const code of ISO_COUNTRY_CODES) {
    const name = display.of(code);
    if (name && name !== code) index.set(fold(name), code);
  }
  for (const [alias, code] of Object.entries(NAME_ALIASES)) index.set(fold(alias), code);
  nameIndex = index;
  return index;
}

// Strips postal codes and other digits so "75001 Paris" or "France 75001"
// can still match a name segment exactly.
function cleanSegment(segment: string): string {
  return fold(segment.replace(/\d+/g, ' ')).replace(/^[\s,.-]+|[\s,.-]+$/g, '');
}

export function checkCountryConsistency(lead: { country?: unknown; address?: unknown }): CountryCheck {
  const country = typeof lead.country === 'string' ? lead.country.trim().toUpperCase() : '';
  if (!country) return { reason: 'missing' };
  if (!isValidIsoCountry(country)) return { reason: 'invalid-code', evidence: String(lead.country) };

  const address = typeof lead.address === 'string' ? lead.address.trim() : '';
  if (!address) return { reason: 'no-address' };

  const segments = address.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const names = countryNameIndex();

  // Full country names, checked from the end of the address backwards.
  for (const segment of [...segments].reverse().slice(0, 3)) {
    const cleaned = cleanSegment(segment);
    const code = names.get(cleaned);
    if (!code) continue;
    if (US_STATE_NAME_COLLISIONS.has(cleaned) && country === 'US') return { reason: 'consistent', evidence: segment };
    if (code === country) return { reason: 'consistent', evidence: segment };
    return { reason: 'mismatch', evidenceCode: code, evidence: segment };
  }

  // A bare two-letter tail, possibly after a postal code ("…, CA 94107").
  const last = segments[segments.length - 1] || '';
  const tailMatch = last.replace(/\d[\d\s-]*$/, '').trim().match(/(?:^|\s)([A-Za-z]{2})$/);
  const tail = tailMatch ? tailMatch[1].toUpperCase() : '';
  if (!tail) return { reason: 'no-evidence' };
  if (country === 'US' && US_STATES_AND_DC.has(tail)) return { reason: 'consistent', evidence: last };
  if (tail === country) return { reason: 'echo-only', evidence: last };
  if (US_STATE_ISO_COLLISIONS.has(tail) || US_STATES_AND_DC.has(tail)) return { reason: 'ambiguous-tail', evidence: last };
  if (ISO_COUNTRY_CODES.has(tail)) return { reason: 'tail-code-differs', evidenceCode: tail, evidence: last };
  return { reason: 'no-evidence' };
}
