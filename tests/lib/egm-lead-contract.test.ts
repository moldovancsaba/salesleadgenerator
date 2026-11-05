import { describe, it, expect } from 'vitest';
import { validateLeadPayload } from '../../lib/validate-lead';
import { PRO_FIELD, CON_FIELD } from '../../app/lib/brand-constants';
import { decodeHtmlEntities, decodeHtmlEntitiesInArray } from '../../lib/text-sanitize';

describe('Level 2 Operational EGM Lead API Contract Verification', () => {
  const baseTenant = 'cogmap';
  const forbiddenTerms = ['forbidden_vendor_term'];

  it('validates partial update payloads containing only value_proposition', () => {
    const payload = {
      value_proposition: 'Delivers real-time cognitive decision diagnostics for academy athletes and coaches.',
    };
    const validation = validateLeadPayload(payload, baseTenant, forbiddenTerms, { partial: true });
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('validates partial update payloads containing pro_for_organization and con_for_organization arrays', () => {
    const payload = {
      [PRO_FIELD]: [
        'Direct relationship with sporting director confirmed',
        'Strong annual budget for cognitive assessments',
      ],
      [CON_FIELD]: [
        'Decision timeline extends across the summer transfer window',
      ],
    };
    const validation = validateLeadPayload(payload, baseTenant, forbiddenTerms, { partial: true });
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('rejects pro_for_organization when provided as a string instead of array of strings', () => {
    const payload = {
      [PRO_FIELD]: 'Single scalar pro string should fail',
    };
    const validation = validateLeadPayload(payload, baseTenant, forbiddenTerms, { partial: true });
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.includes('pro_for_organization must be an array of strings'))).toBe(true);
  });

  it('rejects con_for_organization when containing non-string items', () => {
    const payload = {
      [CON_FIELD]: [123, null] as any,
    };
    const validation = validateLeadPayload(payload, baseTenant, forbiddenTerms, { partial: true });
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.includes('con_for_organization must be an array of strings'))).toBe(true);
  });

  it('rejects value_proposition if it contains brand forbidden vocabulary', () => {
    const payload = {
      value_proposition: 'Mentions forbidden_vendor_term inside the value prop text',
    };
    const validation = validateLeadPayload(payload, baseTenant, forbiddenTerms, { partial: true });
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.includes('contains forbidden cogmap content'))).toBe(true);
  });

  it('cleans HTML entity artifacts (&amp;, &gt;, &lt;) in value props and pro/con arrays', () => {
    const dirtyVp = 'Provides analytics for Coaches &amp; Technical Staff';
    const cleanedVp = decodeHtmlEntities(dirtyVp);
    expect(cleanedVp).toBe('Provides analytics for Coaches & Technical Staff');

    const dirtyPros = ['Budget approved by CEO &amp; Board', 'High score &gt; 90%'];
    const cleanedPros = decodeHtmlEntitiesInArray(dirtyPros);
    expect(cleanedPros).toEqual(['Budget approved by CEO & Board', 'High score > 90%']);
  });
});
