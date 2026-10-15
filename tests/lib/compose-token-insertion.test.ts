import { describe, it, expect } from 'vitest';
import {
  insertTokenAtCaret,
  resolveTokenPreview,
  COMPOSE_TOKENS,
} from '../../lib/compose-token-insertion';

describe('compose-token-insertion', () => {
  describe('COMPOSE_TOKENS catalog', () => {
    it('defines standard merge tokens with valid keys and labels', () => {
      expect(COMPOSE_TOKENS.length).toBeGreaterThan(0);
      for (const item of COMPOSE_TOKENS) {
        expect(item.token).toMatch(/^\{[a-z_]+\}$/);
        expect(item.key).toBeTruthy();
        expect(item.label).toBeTruthy();
      }
      const tokenNames = COMPOSE_TOKENS.map((t) => t.token);
      expect(tokenNames).toContain('{first_name}');
      expect(tokenNames).toContain('{last_name}');
      expect(tokenNames).toContain('{contact_name}');
      expect(tokenNames).toContain('{company}');
      expect(tokenNames).toContain('{title}');
      expect(tokenNames).toContain('{industry}');
      expect(tokenNames).toContain('{value_proposition}');
      expect(tokenNames).toContain('{country}');
    });
  });

  describe('insertTokenAtCaret', () => {
    it('inserts at the beginning of existing text (start = 0, end = 0)', () => {
      const initial = 'Hello there';
      const result = insertTokenAtCaret(initial, '{first_name}', 0, 0);
      expect(result.text).toBe('{first_name}Hello there');
      expect(result.caretIndex).toBe(12);
    });

    it('inserts in the middle of text at cursor position (start = end)', () => {
      const initial = 'Hi , how are you?';
      const result = insertTokenAtCaret(initial, '{first_name}', 3, 3);
      expect(result.text).toBe('Hi {first_name}, how are you?');
      expect(result.caretIndex).toBe(15);
    });

    it('inserts at the end of text when cursor is at the end', () => {
      const initial = 'Dear ';
      const result = insertTokenAtCaret(initial, '{contact_name}', 5, 5);
      expect(result.text).toBe('Dear {contact_name}');
      expect(result.caretIndex).toBe(19);
    });

    it('replaces highlighted selection range cleanly (start < end)', () => {
      const initial = 'Hello [NAME], welcome!';
      // replace "[NAME]" which spans from index 6 to 12
      const result = insertTokenAtCaret(initial, '{first_name}', 6, 12);
      expect(result.text).toBe('Hello {first_name}, welcome!');
      expect(result.caretIndex).toBe(18);
    });

    it('handles inverted selection range gracefully (start > end)', () => {
      const initial = 'Hello [NAME], welcome!';
      // backwards selection from 12 back to 6
      const result = insertTokenAtCaret(initial, '{first_name}', 12, 6);
      expect(result.text).toBe('Hello {first_name}, welcome!');
      expect(result.caretIndex).toBe(18);
    });

    it('defaults to appending at end if selection is null or undefined', () => {
      const initial = 'Welcome';
      const resultNull = insertTokenAtCaret(initial, '{company}', null, null);
      expect(resultNull.text).toBe('Welcome{company}');
      expect(resultNull.caretIndex).toBe(16);

      const resultUndef = insertTokenAtCaret(initial, '{company}');
      expect(resultUndef.text).toBe('Welcome{company}');
      expect(resultUndef.caretIndex).toBe(16);
    });

    it('clamps out-of-bounds start and end indices to text boundaries', () => {
      const initial = 'Start';
      const resultNegative = insertTokenAtCaret(initial, '{first_name}', -5, -2);
      expect(resultNegative.text).toBe('{first_name}Start');
      expect(resultNegative.caretIndex).toBe(12);

      const resultBeyond = insertTokenAtCaret(initial, '{first_name}', 500, 600);
      expect(resultBeyond.text).toBe('Start{first_name}');
      expect(resultBeyond.caretIndex).toBe(17);
    });

    it('automatically wraps bare token without braces in single braces', () => {
      const initial = 'Hi ';
      const result = insertTokenAtCaret(initial, 'first_name', 3, 3);
      expect(result.text).toBe('Hi {first_name}');
      expect(result.caretIndex).toBe(15);
    });

    it('inserts correctly into empty string', () => {
      const result = insertTokenAtCaret('', '{first_name}', 0, 0);
      expect(result.text).toBe('{first_name}');
      expect(result.caretIndex).toBe(12);
    });
  });

  describe('resolveTokenPreview', () => {
    const mockContext = {
      contact_name: 'Jane Doe',
      first_name: 'Jane',
      last_name: 'Doe',
      company_name: 'Acme Corp',
      company: 'Acme Corp',
      job_title: 'Chief Technology Officer',
      title: 'Chief Technology Officer',
      industry: 'Software',
      value_proposition: 'AI Pipeline Automation',
      country: 'Germany',
      number_stat: 42,
      active_bool: true,
    };

    it('resolves direct keys and canonical alias keys', () => {
      expect(resolveTokenPreview('first_name', mockContext)).toBe('Jane');
      expect(resolveTokenPreview('contact_name', mockContext)).toBe('Jane Doe');
      expect(resolveTokenPreview('company', mockContext)).toBe('Acme Corp');
      expect(resolveTokenPreview('job_title', mockContext)).toBe('Chief Technology Officer');
      expect(resolveTokenPreview('title', mockContext)).toBe('Chief Technology Officer');
      expect(resolveTokenPreview('industry', mockContext)).toBe('Software');
      expect(resolveTokenPreview('value_proposition', mockContext)).toBe('AI Pipeline Automation');
      expect(resolveTokenPreview('country', mockContext)).toBe('Germany');
    });

    it('handles numeric and boolean values', () => {
      expect(resolveTokenPreview('number_stat', mockContext)).toBe('42');
      expect(resolveTokenPreview('active_bool', mockContext)).toBe('true');
    });

    it('returns empty string for missing or null contexts and unknown tokens', () => {
      expect(resolveTokenPreview('unknown_token', mockContext)).toBe('');
      expect(resolveTokenPreview('first_name', null)).toBe('');
      expect(resolveTokenPreview('first_name', undefined)).toBe('');
      expect(resolveTokenPreview('', mockContext)).toBe('');
    });
  });
});
