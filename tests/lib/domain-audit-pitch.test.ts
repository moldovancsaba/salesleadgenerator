import { describe, it, expect } from 'vitest';
import { generateDomainAuditPitch } from '@/lib/domain-audit-pitch';
import { interpolateTemplate, buildPersonalizationContext } from '@/lib/template-personalization';

describe('Domain & Digital Presence Audit Pitch Generator (Issue 293)', () => {
  it('generates e-commerce monetization angle when shopify is detected', () => {
    const summary = generateDomainAuditPitch('Real Madrid', ['shopify', 'gtm']);

    expect(summary.hasEcommerce).toBe(true);
    expect(summary.hasAnalytics).toBe(true);
    expect(summary.primaryCms).toBe('Shopify');
    expect(summary.pitchAngles.some((a) => a.category === 'ecommerce')).toBe(true);
    expect(summary.recommendedPitch).toContain('Shopify');
  });

  it('generates zero-party fan data capture angle when no analytics/tracking pixels detected', () => {
    const summary = generateDomainAuditPitch('Inter Milan', ['wordpress']);

    expect(summary.hasAnalytics).toBe(false);
    expect(summary.primaryCms).toBe('WordPress');
    expect(summary.pitchAngles.some((a) => a.category === 'fan_engagement')).toBe(true);
    expect(summary.pitchAngles.some((a) => a.id === 'zero_party_data_capture')).toBe(true);
  });

  it('generates modern portal experience angle when nextjs/react is detected', () => {
    const summary = generateDomainAuditPitch('Arsenal FC', ['nextjs', 'react']);

    expect(summary.hasModernFrontend).toBe(true);
    expect(summary.pitchAngles.some((a) => a.category === 'cms_modernization')).toBe(true);
    expect(summary.recommendedPitch).toContain('React/Next.js');
  });

  it('interpolates {{digital_audit_pitch}} token into outreach templates', () => {
    const lead = {
      entity_name: 'Juventus FC',
      techStackSignals: ['shopify'],
      techStackScannedAt: '2026-10-28T00:00:00.000Z',
    };

    const contact = {
      name: 'Giorgio Chiellini',
      email: 'chiellini@juventus.com',
    };

    const context = buildPersonalizationContext({ lead: lead as any, contact: contact as any });
    expect(context.digital_audit_pitch).toContain('Shopify');

    const template = 'Hi {{first_name}}, {{digital_audit_pitch}} Looking forward to connecting!';
    const rendered = interpolateTemplate(template, context);

    expect(rendered).toContain('Hi Giorgio,');
    expect(rendered).toContain('Shopify');
    expect(rendered).toContain('Looking forward to connecting!');
  });
});
