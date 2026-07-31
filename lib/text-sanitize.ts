// Shared text-sanitization helper — a single source of truth for decoding
// stray HTML-entity artifacts (e.g. "&amp;" instead of a literal "&") out of
// agent- or human-authored free text before it's stored.
//
// Real, repeated incident: the lead-taxonomy classification loop (issue
// #132) found this exact artifact in agent output across many separate
// batches (2.4.132, 2.4.138, 2.4.140, 2.4.141, 2.4.144 — the single most
// frequent real mistake the loop's manual validation step caught) despite
// every batch's prompt explicitly warning against it. Fixing it once at the
// storage boundary, instead of relying on every future prompt/agent to
// remember, closes the whole class of bug rather than one instance of it.

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

const HTML_ENTITY_RE = new RegExp(Object.keys(HTML_ENTITY_MAP).join('|'), 'g');

export function decodeHtmlEntities(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (!value.includes('&')) return value;
  return value.replace(HTML_ENTITY_RE, (match) => HTML_ENTITY_MAP[match] ?? match);
}

export function decodeHtmlEntitiesInArray(values: any): any {
  if (!Array.isArray(values)) return values;
  return values.map((v) => (typeof v === 'string' ? decodeHtmlEntities(v) : v));
}
