import { describe, it, expect } from 'vitest';
import { normalizeLead } from '../../app/lib/normalize-lead';

describe('normalizeLead', () => {
  it('sanitizes sport_or_sector the same way as industry (strips control chars, trims, caps length)', () => {
    const lead = normalizeLead({
      entity_name: 'Acme',
      industry: '  Financial Services\x00 ',
      sport_or_sector: '  Quantitative Hedge Fund\x00 ',
    });
    expect(lead.industry).toBe('Financial Services');
    expect(lead.sport_or_sector).toBe('Quantitative Hedge Fund');
  });

  it('keeps industry and sport_or_sector as distinct values, not merged', () => {
    const lead = normalizeLead({
      entity_name: 'Acme',
      industry: 'Financial Services',
      sport_or_sector: 'Quantitative Hedge Fund',
    });
    expect(lead.industry).toBe('Financial Services');
    expect(lead.sport_or_sector).toBe('Quantitative Hedge Fund');
  });

  it('falls back industry to sport_or_sector when industry is missing, without mutating sport_or_sector', () => {
    const lead = normalizeLead({
      entity_name: 'Acme',
      sport_or_sector: 'Quantitative Hedge Fund',
    });
    expect(lead.industry).toBe('Quantitative Hedge Fund');
    expect(lead.sport_or_sector).toBe('Quantitative Hedge Fund');
  });

  it('coerces a non-string sport_or_sector to an empty string instead of passing it through raw', () => {
    const lead = normalizeLead({
      entity_name: 'Acme',
      sport_or_sector: { nested: 'object' },
    });
    expect(lead.sport_or_sector).toBe('');
  });
});
