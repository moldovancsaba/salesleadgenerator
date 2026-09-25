import { describe, it, expect } from 'vitest';
import { generateShareToken } from '../../app/lib/quotes-store';

// Issue #211 §19 — asserts shareToken generation produces a value of the
// required length/entropy class (>=128 bits, per §9's own contract), not a
// predictable one. No DB needed for this — generateShareToken is pure
// crypto.randomBytes, kept alongside the Mongo-aware store for locality but
// unit-testable in isolation like this.
describe('generateShareToken (issue 211)', () => {
  it('is a 32-character hex string — 16 bytes, 128 bits of entropy', () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is different on every call — never derived from anything predictable', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateShareToken()));
    expect(tokens.size).toBe(50);
  });
});
