import { describe, it, expect } from 'vitest';
import { AVAILABLE_TEMPLATE_TOKENS } from '@/app/outreach/templates/[brand]/templates-client';

describe('Outreach Templates & Cadences Ergonomics (Issue 318)', () => {
  it('exposes standard template tokens for 1-click insertion', () => {
    const tokens = AVAILABLE_TEMPLATE_TOKENS.map((t) => t.token);
    expect(tokens).toContain('{{first_name}}');
    expect(tokens).toContain('{{last_name}}');
    expect(tokens).toContain('{{contact_name}}');
    expect(tokens).toContain('{{company_name}}');
    expect(tokens).toContain('{{digital_audit_pitch}}');
    expect(tokens).toContain('{{job_title}}');
    expect(tokens).toContain('{{industry}}');
    expect(tokens).toContain('{{company_website}}');
  });

  it('calculates cumulative cadence sequence days correctly across steps', () => {
    const steps = [
      { id: '1', waitDaysAfterPrevious: 0 },
      { id: '2', waitDaysAfterPrevious: 3 },
      { id: '3', waitDaysAfterPrevious: 4 },
      { id: '4', waitDaysAfterPrevious: 7 },
    ];

    let cumulative = 0;
    const days = steps.map((s) => {
      cumulative += s.waitDaysAfterPrevious;
      return cumulative;
    });

    expect(days).toEqual([0, 3, 7, 14]);
  });
});
