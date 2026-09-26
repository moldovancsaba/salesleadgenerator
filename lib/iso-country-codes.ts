// The 249 officially assigned ISO 3166-1 alpha-2 codes, copied from the
// Debian iso-codes project (data/iso_3166-1.json) and cross-checked against
// datasets/country-codes on 2026-09-26 — both sources agree exactly.
//
// Why a literal list and not Intl.DisplayNames: Intl returns a display name
// for values that are NOT assigned country codes (EA "Ceuta & Melilla", UK,
// EU, ZZ, QO, IC, DG), so it would accept precisely the bad stored values
// issues #222/#223 found. A format-only /^[A-Z]{2}$/ check accepts them too.
const OFFICIAL_ISO_3166_1_ALPHA_2 = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
] as const;

// XK (Kosovo) is user-assigned, not officially assigned, but is used by the
// EU, the IMF and most sports bodies, and Kosovo's football federation is a
// real lead in this database. Kept deliberately; this is a policy choice,
// not a data error — see issue #222's follow-on validator issue.
const ACCEPTED_EXCEPTIONS = ['XK'] as const;

export const ISO_COUNTRY_CODES: ReadonlySet<string> = new Set<string>([
  ...OFFICIAL_ISO_3166_1_ALPHA_2,
  ...ACCEPTED_EXCEPTIONS,
]);

export function isValidIsoCountry(code: unknown): code is string {
  return typeof code === 'string' && ISO_COUNTRY_CODES.has(code);
}

// US state/territory postal abbreviations that are also ISO country codes.
// A bare "…, DE" or "…, TN" at the end of a US-style address is a state, not
// Germany or Tunisia — callers deriving a country from an address must treat
// these as ambiguous rather than as a country hit. 26 of the 51 state/DC
// codes collide, plus 8 territory codes (AS FM GU MH MP PR PW VI).
// Corrected 2026-09-26: the first version missed TN, VA, AS and GU.
export const US_STATE_ISO_COLLISIONS: ReadonlySet<string> = new Set([
  'AL', 'AR', 'AZ', 'CA', 'CO', 'DE', 'GA', 'ID', 'IL', 'IN', 'KY', 'LA', 'MA',
  'MD', 'ME', 'MN', 'MO', 'MS', 'MT', 'NC', 'NE', 'PA', 'SC', 'SD', 'TN', 'VA',
  'AS', 'FM', 'GU', 'MH', 'MP', 'PR', 'PW', 'VI',
]);
