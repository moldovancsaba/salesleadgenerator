import { describe, it, expect } from 'vitest';
import { buildLineItemFromDeal, sumLineItems, isValidStatusTransition, toPublicQuote, type Quote } from '../../lib/quotes';

describe('buildLineItemFromDeal (issue 211)', () => {
  it('snapshots the deal value/currency/label exactly', () => {
    const item = buildLineItemFromDeal({ value: 50000, currency: 'USD', label: 'Season sponsorship renewal' }, 'CogMap');
    expect(item).toEqual({ label: 'Season sponsorship renewal', value: 50000, currency: 'USD' });
  });

  it('falls back to a generic brand-derived label when the deal has none', () => {
    const item = buildLineItemFromDeal({ value: 1000, currency: 'EUR' }, 'Seyu');
    expect(item?.label).toBe('Seyu — Services');
  });

  it('trims a whitespace-only label and falls back to the generic one', () => {
    const item = buildLineItemFromDeal({ value: 1000, currency: 'USD', label: '   ' }, 'CogMap');
    expect(item?.label).toBe('CogMap — Services');
  });

  it('returns null for a non-positive value — never a fabricated $0 line item', () => {
    expect(buildLineItemFromDeal({ value: 0, currency: 'USD' }, 'CogMap')).toBeNull();
    expect(buildLineItemFromDeal({ value: -100, currency: 'USD' }, 'CogMap')).toBeNull();
  });

  it('returns null for a non-finite value', () => {
    expect(buildLineItemFromDeal({ value: NaN, currency: 'USD' }, 'CogMap')).toBeNull();
  });

  it('shows the already-clamped value exactly as stored at the ABSOLUTE_CEILING', () => {
    const item = buildLineItemFromDeal({ value: 50_000_000, currency: 'USD', label: 'Enterprise deal' }, 'CogMap');
    expect(item?.value).toBe(50_000_000);
  });
});

describe('sumLineItems (issue 211)', () => {
  it('sums a single line item (v1 always resolves to exactly this)', () => {
    expect(sumLineItems([{ label: 'x', value: 5000, currency: 'USD' }])).toBe(5000);
  });

  it('sums multiple line items (forward-compatible with a future multi-line quote)', () => {
    expect(sumLineItems([
      { label: 'a', value: 1000, currency: 'USD' },
      { label: 'b', value: 2000, currency: 'USD' },
    ])).toBe(3000);
  });

  it('returns 0 for an empty array', () => {
    expect(sumLineItems([])).toBe(0);
  });
});

describe('isValidStatusTransition (issue 211)', () => {
  it('allows the standard forward path', () => {
    expect(isValidStatusTransition('draft', 'sent')).toBe(true);
    expect(isValidStatusTransition('sent', 'viewed')).toBe(true);
    expect(isValidStatusTransition('viewed', 'signed')).toBe(true);
  });

  it('allows sent -> signed directly (a prospect may sign without the view route ever firing)', () => {
    expect(isValidStatusTransition('sent', 'signed')).toBe(true);
  });

  it('rejects skipping straight from draft to signed', () => {
    expect(isValidStatusTransition('draft', 'signed')).toBe(false);
  });

  it('rejects skipping straight from draft to viewed', () => {
    expect(isValidStatusTransition('draft', 'viewed')).toBe(false);
  });

  it('rejects every backward transition', () => {
    expect(isValidStatusTransition('signed', 'viewed')).toBe(false);
    expect(isValidStatusTransition('signed', 'sent')).toBe(false);
    expect(isValidStatusTransition('signed', 'draft')).toBe(false);
    expect(isValidStatusTransition('viewed', 'sent')).toBe(false);
    expect(isValidStatusTransition('viewed', 'draft')).toBe(false);
    expect(isValidStatusTransition('sent', 'draft')).toBe(false);
  });

  it('rejects every same-status "transition" — never a valid no-op success', () => {
    expect(isValidStatusTransition('draft', 'draft')).toBe(false);
    expect(isValidStatusTransition('sent', 'sent')).toBe(false);
    expect(isValidStatusTransition('viewed', 'viewed')).toBe(false);
    expect(isValidStatusTransition('signed', 'signed')).toBe(false);
  });

  it('signed has no outgoing transitions at all', () => {
    expect(isValidStatusTransition('signed', 'draft')).toBe(false);
    expect(isValidStatusTransition('signed', 'sent')).toBe(false);
    expect(isValidStatusTransition('signed', 'viewed')).toBe(false);
    expect(isValidStatusTransition('signed', 'signed')).toBe(false);
  });
});

describe('toPublicQuote (issue 211)', () => {
  it('strips pdfBlobPath/shareToken and adds viewUrl, keeping every other field', () => {
    const quote: Quote = {
      _id: 'q1', tenantId: 'default', brand: 'cogmap', leadId: 'lead1', dealId: 'deal1',
      status: 'draft', lineItems: [{ label: 'x', value: 1000, currency: 'USD' }],
      totalValue: 1000, currency: 'USD',
      pdfBlobPath: 'quotes/default/q1.pdf', shareToken: 'super-secret-token',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdBy: 'rep@example.com',
    };
    const publicQuote = toPublicQuote(quote, 'https://example.com/api/quotes/q1/view?token=super-secret-token');
    expect(publicQuote).not.toHaveProperty('pdfBlobPath');
    expect(publicQuote).not.toHaveProperty('shareToken');
    expect(publicQuote.viewUrl).toBe('https://example.com/api/quotes/q1/view?token=super-secret-token');
    expect(publicQuote._id).toBe('q1');
    expect(publicQuote.status).toBe('draft');
    expect(publicQuote.totalValue).toBe(1000);
  });
});
