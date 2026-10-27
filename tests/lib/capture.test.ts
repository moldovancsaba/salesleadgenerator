import { describe, it, expect } from 'vitest';
import { capturePayloadSchema, parseLinkedInLocation } from '@/lib/capture';

describe('LinkedIn Capture parsing and validation', () => {
  it('validates and cleans valid capture payloads', () => {
    const raw = {
      brand: 'cogmap',
      url: 'https://www.linkedin.com/in/janedoe',
      name: 'Jane Doe',
      headline: 'Commercial Director at AC Milan',
      companyName: 'AC Milan',
      location: 'Milan, Lombardy, Italy',
      jobTitle: 'Commercial Director',
      email: 'jane.doe@acmilan.com',
      phone: '+39 02 123456',
      websiteUrl: 'https://acmilan.com',
      bio: 'Experienced sports marketing professional.',
      buyingRole: 'decision_maker',
    };

    const parsed = capturePayloadSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.brand).toBe('cogmap');
    expect(parsed.data.url).toBe('https://www.linkedin.com/in/janedoe');
    expect(parsed.data.name).toBe('Jane Doe');
    expect(parsed.data.buyingRole).toBe('decision_maker');
    expect(parsed.data.companyName).toBe('AC Milan');
    expect(parsed.data.email).toBe('jane.doe@acmilan.com');
  });

  it('tolerates missing optional fields and applies sensible defaults', () => {
    const minimal = {
      brand: 'seyu',
      url: 'https://www.linkedin.com/in/johnsmith/',
    };

    const parsed = capturePayloadSchema.safeParse(minimal);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.brand).toBe('seyu');
    expect(parsed.data.name).toBeUndefined();
    expect(parsed.data.buyingRole).toBe('champion');
  });

  it('rejects invalid or missing brand and URLs', () => {
    const invalidUrl = {
      brand: 'seyu',
      url: 'not-a-valid-url',
    };
    expect(capturePayloadSchema.safeParse(invalidUrl).success).toBe(false);

    const missingBrand = {
      brand: '',
      url: 'https://www.linkedin.com/in/sample',
    };
    expect(capturePayloadSchema.safeParse(missingBrand).success).toBe(false);
  });

  it('correctly parses LinkedIn location lines into city, region, and country', () => {
    expect(parseLinkedInLocation('Budapest, Hungary')).toEqual({
      city: 'Budapest',
      country: 'Hungary',
    });

    expect(parseLinkedInLocation('Milan, Lombardy, Italy')).toEqual({
      city: 'Milan',
      region: 'Lombardy',
      country: 'Italy',
    });

    expect(parseLinkedInLocation('San Francisco')).toEqual({
      city: 'San Francisco',
    });

    expect(parseLinkedInLocation('')).toEqual({});
  });
});
