import { describe, it, expect } from 'vitest';
import { normalizeTitle } from '../../lib/title-normalization';

describe('normalizeTitle', () => {
  it('returns Unknown/Unknown for an empty, missing, or non-string title, never throwing', () => {
    expect(normalizeTitle('')).toEqual({ seniorityTier: 'Unknown', department: 'Unknown' });
    expect(normalizeTitle('   ')).toEqual({ seniorityTier: 'Unknown', department: 'Unknown' });
    expect(normalizeTitle(undefined)).toEqual({ seniorityTier: 'Unknown', department: 'Unknown' });
    expect(normalizeTitle(null)).toEqual({ seniorityTier: 'Unknown', department: 'Unknown' });
    expect(() => normalizeTitle(42 as any)).not.toThrow();
    expect(normalizeTitle(42 as any)).toEqual({ seniorityTier: 'Unknown', department: 'Unknown' });
  });

  it('matches exact common titles', () => {
    expect(normalizeTitle('CEO')).toEqual({ seniorityTier: 'C-level', department: 'Executive' });
    expect(normalizeTitle('Director of Operations')).toEqual({ seniorityTier: 'Director', department: 'Operations' });
    expect(normalizeTitle('Sales Manager')).toEqual({ seniorityTier: 'Manager', department: 'Sales' });
  });

  it('is case- and punctuation-insensitive', () => {
    expect(normalizeTitle('ceo')).toEqual({ seniorityTier: 'C-level', department: 'Executive' });
    expect(normalizeTitle('  Vice President, Sales  ')).toEqual({ seniorityTier: 'VP', department: 'Sales' });
    expect(normalizeTitle('VP SALES')).toEqual({ seniorityTier: 'VP', department: 'Sales' });
  });

  it('resolves multi-role titles per the issue\'s own worked examples', () => {
    expect(normalizeTitle('Chief Revenue Officer')).toEqual({ seniorityTier: 'C-level', department: 'Sales' });
    expect(normalizeTitle('VP of Sales & Marketing')).toEqual({ seniorityTier: 'VP', department: 'Sales' });
    expect(normalizeTitle('Owner')).toEqual({ seniorityTier: 'Unknown', department: 'Executive' });
    expect(normalizeTitle('Founder & CEO')).toEqual({ seniorityTier: 'C-level', department: 'Executive' });
  });

  it('resolves C-suite abbreviations to C-level', () => {
    for (const title of ['SVP', 'EVP', 'COO', 'CFO', 'CRO', 'CTO', 'CMO']) {
      expect(normalizeTitle(title).seniorityTier).toBe(title === 'SVP' || title === 'EVP' ? 'VP' : 'C-level');
    }
  });

  it('resolves a role description with no seniority keyword to IC, department still resolved', () => {
    expect(normalizeTitle('Sales Representative')).toEqual({ seniorityTier: 'IC', department: 'Sales' });
    expect(normalizeTitle('Marketing Coordinator')).toEqual({ seniorityTier: 'IC', department: 'Marketing' });
  });

  it('falls back gracefully for a non-English/non-Latin-script title rather than mis-mapping', () => {
    expect(normalizeTitle('首席执行官')).toEqual({ seniorityTier: 'Unknown', department: 'Unknown' });
    expect(normalizeTitle('Директор по продажам')).toEqual({ seniorityTier: 'Unknown', department: 'Unknown' });
  });

  it('applies fixed C-level > VP > Director > Manager precedence when multiple tier keywords could match', () => {
    // "Director" is a substring context here but "Chief" should still win.
    expect(normalizeTitle('Chief Director of Sales').seniorityTier).toBe('C-level');
  });
});
