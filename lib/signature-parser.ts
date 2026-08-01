// Issue #142 — lightweight, regex-based email signature-block parser. No
// NLP dependency, matching this repo's existing lightweight-heuristics style
// (e.g. lib/title-normalization.ts). Deliberately conservative: returns null
// rather than a low-confidence guess when nothing signature-shaped is found,
// since a false-positive candidate contact would go on to generate a wrong
// suggestion for a human to review.

export type ParsedSignature = {
  name?: string;
  title?: string;
  phone?: string;
};

// A phone-shaped line: at least 8 digits total, allowing the common
// separators (space, dash, dot, parens) and an optional leading +.
const PHONE_LINE_RE = /(\+?\d[\d\-.\s()]{6,}\d)/;

// A plausible "First Last" (up to 4 words) name line — title-cased words
// only, no digits/punctuation beyond hyphen/apostrophe (matches
// lib/contacts.ts's own toNameCase() output shape). Capped at 60 chars so a
// long sentence that happens to start with capitals isn't misread as a name.
const NAME_LINE_RE = /^[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,3}$/;

const CLOSING_PHRASE_RE = /^(regards|best regards|best|thanks|thank you|sincerely|cheers|kind regards|warm regards)[,.]?$/i;

// Signature blocks sit at the tail of a reply, below the actual message and
// above any quoted thread history — only the last few non-empty lines are
// considered, not the whole body.
const TAIL_LINES = 8;

export function parseSignatureBlock(bodyText: string | undefined | null): ParsedSignature | null {
  if (!bodyText) return null;
  const lines = bodyText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const tail = lines.slice(-TAIL_LINES);

  let name: string | undefined;
  let title: string | undefined;
  let phone: string | undefined;

  for (const line of tail) {
    if (CLOSING_PHRASE_RE.test(line)) continue;

    if (!phone) {
      const phoneMatch = PHONE_LINE_RE.exec(line);
      if (phoneMatch) {
        phone = phoneMatch[1].trim();
        continue;
      }
    }

    if (!name && line.length <= 60 && NAME_LINE_RE.test(line)) {
      name = line;
      continue;
    }

    // The first non-closing, non-phone line found immediately after the
    // detected name is read as the title — the standard "Name\nTitle"
    // signature shape. Only the first such line counts; anything after
    // (company name, address, disclaimer) is not captured.
    if (name && !title && line !== name && line.length <= 80) {
      title = line;
    }
  }

  if (!name && !title && !phone) return null;
  return { name, title, phone };
}
