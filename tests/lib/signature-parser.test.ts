import { describe, it, expect } from 'vitest';
import { parseSignatureBlock } from '../../lib/signature-parser';

describe('parseSignatureBlock', () => {
  it('parses a real-shaped Name / Title / Phone signature', () => {
    const body = [
      "Thanks for reaching out, this looks like a great fit for us.",
      "",
      "Best regards,",
      "Jane Doe",
      "VP of Partnerships",
      "+1 555 123 4567",
    ].join('\n');
    const result = parseSignatureBlock(body);
    expect(result).toEqual({ name: 'Jane Doe', title: 'VP of Partnerships', phone: '+1 555 123 4567' });
  });

  it('parses name and title with no phone present', () => {
    const body = [
      "Sounds good, let's set up a call.",
      "",
      "Regards,",
      "John Smith",
      "Director of Sponsorships",
    ].join('\n');
    const result = parseSignatureBlock(body);
    expect(result).toEqual({ name: 'John Smith', title: 'Director of Sponsorships' });
  });

  it('parses a phone-only signature with no name/title line', () => {
    const body = "Call me at +1-804-823-9191 to discuss further.";
    const result = parseSignatureBlock(body);
    expect(result?.phone).toBe('+1-804-823-9191');
    expect(result?.name).toBeUndefined();
  });

  it('returns null for a body with no signature-shaped content', () => {
    const body = "yes that works for me, see you then";
    expect(parseSignatureBlock(body)).toBeNull();
  });

  it('returns null for empty/undefined/null input', () => {
    expect(parseSignatureBlock('')).toBeNull();
    expect(parseSignatureBlock(undefined)).toBeNull();
    expect(parseSignatureBlock(null)).toBeNull();
  });

  it('does not misread a closing phrase as the name or title', () => {
    const body = [
      "Looking forward to it.",
      "",
      "Best regards,",
      "Maria Garcia",
      "Head of Brand",
    ].join('\n');
    const result = parseSignatureBlock(body);
    expect(result?.name).toBe('Maria Garcia');
    expect(result?.title).toBe('Head of Brand');
  });

  it('only reads the tail of a long body, ignoring an earlier quoted thread', () => {
    const quotedThread = Array.from({ length: 20 }, (_, i) => `Quoted line ${i} from an earlier message in the thread`).join('\n');
    const body = `${quotedThread}\n\nSure, that works.\n\nRegards,\nAlex Chen\nMarketing Manager\n+44 20 7946 0958`;
    const result = parseSignatureBlock(body);
    expect(result).toEqual({ name: 'Alex Chen', title: 'Marketing Manager', phone: '+44 20 7946 0958' });
  });

  it('does not treat a long sentence starting with a capital as a name', () => {
    const body = "Thanks, that sounds great and works perfectly for our schedule this week.";
    const result = parseSignatureBlock(body);
    // No name-shaped (2-4 title-cased words, <=60 chars) line and no phone --
    // the whole thing reads as prose, not a signature.
    expect(result).toBeNull();
  });
});
