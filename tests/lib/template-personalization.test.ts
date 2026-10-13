import { describe, it, expect } from 'vitest';
import {
  resolveCanonicalToken,
  splitContactName,
  buildPersonalizationContext,
  interpolateTemplate,
  validatePersonalization,
  CANONICAL_TOKENS,
} from '../../lib/template-personalization';

describe('Template Personalization — Token Resolution (issue 241)', () => {
  it('maps known aliases to their canonical token keys', () => {
    expect(resolveCanonicalToken('FirstName')).toBe(CANONICAL_TOKENS.FIRST_NAME);
    expect(resolveCanonicalToken('first_name')).toBe(CANONICAL_TOKENS.FIRST_NAME);
    expect(resolveCanonicalToken('LastName')).toBe(CANONICAL_TOKENS.LAST_NAME);
    expect(resolveCanonicalToken('name')).toBe(CANONICAL_TOKENS.CONTACT_NAME);
    expect(resolveCanonicalToken('Company')).toBe(CANONICAL_TOKENS.COMPANY_NAME);
    expect(resolveCanonicalToken('entity_name')).toBe(CANONICAL_TOKENS.COMPANY_NAME);
    expect(resolveCanonicalToken('Website')).toBe(CANONICAL_TOKENS.COMPANY_WEBSITE);
    expect(resolveCanonicalToken('JobTitle')).toBe(CANONICAL_TOKENS.JOB_TITLE);
    expect(resolveCanonicalToken('title')).toBe(CANONICAL_TOKENS.JOB_TITLE);
    expect(resolveCanonicalToken('linkedin')).toBe(CANONICAL_TOKENS.LINKEDIN_URL);
  });

  it('preserves non-catalog custom field tokens as lowercase clean keys', () => {
    expect(resolveCanonicalToken('budget_tier')).toBe('budget_tier');
    expect(resolveCanonicalToken('custom.vip_status')).toBe('custom.vip_status');
  });
});

describe('splitContactName (issue 241)', () => {
  it('handles empty or whitespace strings', () => {
    expect(splitContactName('')).toEqual({ firstName: '', lastName: '' });
    expect(splitContactName('   ')).toEqual({ firstName: '', lastName: '' });
  });

  it('splits single-word names cleanly with empty last name', () => {
    expect(splitContactName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
    expect(splitContactName('Prince')).toEqual({ firstName: 'Prince', lastName: '' });
  });

  it('splits standard two-part names into first and last', () => {
    expect(splitContactName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(splitContactName('John Doe')).toEqual({ firstName: 'John', lastName: 'Doe' });
  });

  it('splits multi-part names keeping remaining tokens as last name', () => {
    expect(splitContactName('Martin Luther King Jr.')).toEqual({ firstName: 'Martin', lastName: 'Luther King Jr.' });
    expect(splitContactName('Jean-Claude Van Damme')).toEqual({ firstName: 'Jean-Claude', lastName: 'Van Damme' });
  });
});

describe('buildPersonalizationContext (issue 241)', () => {
  it('builds context from lead and contact, deriving first and last names', () => {
    const lead = {
      entity_name: 'Acme Academy',
      website: 'https://acme.org',
      industry: 'Sports',
    };
    const contact = {
      name: 'Ada Lovelace',
      email: 'ada@acme.org',
      secondaryEmail: 'ada.backup@gmail.com',
      phone: '+15551234567',
      linkedin: 'https://linkedin.com/in/ada',
      title: 'Academy Director',
      role: 'Decision Maker',
      buyingRole: 'decision_maker' as const,
      isDecisionMaker: true,
      seniorityTier: 'Director' as const,
      department: 'Executive' as const,
    };

    const ctx = buildPersonalizationContext({ lead, contact });
    expect(ctx.company_name).toBe('Acme Academy');
    expect(ctx.entity_name).toBe('Acme Academy');
    expect(ctx.first_name).toBe('Ada');
    expect(ctx.last_name).toBe('Lovelace');
    expect(ctx.contact_name).toBe('Ada Lovelace');
    expect(ctx.email).toBe('ada@acme.org');
    expect(ctx.secondary_email).toBe('ada.backup@gmail.com');
    expect(ctx.phone).toBe('+15551234567');
    expect(ctx.job_title).toBe('Academy Director');
    expect(ctx.company_website).toBe('https://acme.org');
    expect(ctx.industry).toBe('Sports');
  });

  it('prefers explicit firstName / lastName over derived ones if provided on contact', () => {
    const contact = {
      name: 'Dr. Jane Smith',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      title: 'Head of Science',
      phone: '',
      linkedin: '',
      role: '',
      buyingRole: 'decision_maker' as const,
      isDecisionMaker: true,
      seniorityTier: 'Director' as const,
      department: 'Executive' as const,
    };

    const ctx = buildPersonalizationContext({ contact });
    expect(ctx.first_name).toBe('Jane');
    expect(ctx.last_name).toBe('Smith');
  });

  it('merges customFields into context and supports custom. prefix', () => {
    const contact = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      title: 'Director',
      phone: '',
      linkedin: '',
      role: '',
      buyingRole: 'decision_maker' as const,
      isDecisionMaker: true,
      seniorityTier: 'Director' as const,
      department: 'Executive' as const,
      customFields: {
        budget_tier: 'Tier 1',
        pilot_requested: 'true',
      },
    };

    const ctx = buildPersonalizationContext({ contact });
    expect(ctx.budget_tier).toBe('Tier 1');
    expect(ctx['custom.budget_tier']).toBe('Tier 1');
    expect(ctx.pilot_requested).toBe('true');
  });
});

describe('interpolateTemplate (issue 241)', () => {
  const context = {
    first_name: 'Ada',
    last_name: 'Lovelace',
    contact_name: 'Ada Lovelace',
    company_name: 'Acme Sports',
    entity_name: 'Acme Sports',
    job_title: 'Director of Performance',
    email: 'ada@acme.com',
    industry: 'Football',
    budget_tier: 'Enterprise',
  };

  it('interpolates single-brace {token} variables', () => {
    const template = 'Hi {first_name}, how is {company_name} doing in {industry}?';
    expect(interpolateTemplate(template, context)).toBe('Hi Ada, how is Acme Sports doing in Football?');
  });

  it('interpolates double-brace {{token}} Mustache/Handlebars variables', () => {
    const template = 'Dear {{first_name}} {{last_name}}, we noticed {{company_name}} is expanding.';
    expect(interpolateTemplate(template, context)).toBe('Dear Ada Lovelace, we noticed Acme Sports is expanding.');
  });

  it('interpolates Go-style {{.token}} variables for legacy predecessor compatibility', () => {
    const template = 'Hello {{.first_name}}, as the {{.job_title}} at {{.company_name}}...';
    expect(interpolateTemplate(template, context)).toBe('Hello Ada, as the Director of Performance at Acme Sports...');
  });

  it('supports token aliases case-insensitively', () => {
    const template = 'Hi {FirstName}, saw your work as {JobTitle} at {Company}.';
    expect(interpolateTemplate(template, context)).toBe('Hi Ada, saw your work as Director of Performance at Acme Sports.');
  });

  it('leaves unknown tokens intact when strict option is false (default)', () => {
    const template = 'Hi {first_name}, your unknown code is {unknown_code}.';
    expect(interpolateTemplate(template, context)).toBe('Hi Ada, your unknown code is {unknown_code}.');
  });

  it('strips unknown tokens when strict option is true', () => {
    const template = 'Hi {first_name}, your unknown code is {unknown_code}.';
    expect(interpolateTemplate(template, context, { strict: true })).toBe('Hi Ada, your unknown code is .');
  });
});

describe('validatePersonalization — Required Fields Gating (issue 241)', () => {
  it('returns valid when all required fields are populated in context', () => {
    const template = {
      body: 'Hi {first_name}, welcome to {company_name}',
      required_fields: ['first_name', 'company_name'],
    };
    const context = {
      first_name: 'Ada',
      company_name: 'Acme Corp',
    };
    const res = validatePersonalization(template, context);
    expect(res.valid).toBe(true);
    expect(res.missingFields).toEqual([]);
  });

  it('returns invalid and lists missing fields when required variables are empty or missing', () => {
    const template = {
      body: 'Hi {first_name}, welcome to {company_name}',
      required_fields: ['first_name', 'company_name', 'job_title'],
    };
    const context = {
      first_name: 'Ada',
      company_name: '', // Empty
      // job_title completely missing
    };
    const res = validatePersonalization(template, context);
    expect(res.valid).toBe(false);
    expect(res.missingFields).toEqual(['company_name', 'job_title']);
  });

  it('resolves aliases when checking required fields', () => {
    const template = {
      body: 'Hi {first_name}',
      required_fields: ['FirstName'],
    };
    const context = {
      first_name: 'Ada',
    };
    const res = validatePersonalization(template, context);
    expect(res.valid).toBe(true);
    expect(res.missingFields).toEqual([]);
  });
});
