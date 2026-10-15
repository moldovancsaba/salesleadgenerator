import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeSignatureHtml,
  signatureHtmlToText,
  appendSignatureToBody,
  fetchGmailSignatureFromGoogle,
  syncUserGmailSignature,
} from '../../lib/gmail-signature';
import * as integrationStore from '../../app/lib/integration-store';

describe('gmail-signature (Issue 241)', () => {
  describe('sanitizeSignatureHtml', () => {
    it('strips malicious script and iframe tags', () => {
      const malicious = '<div>Best,<br>Alex</div><script>alert("xss")</script><iframe src="evil.com"></iframe>';
      const clean = sanitizeSignatureHtml(malicious);
      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('<iframe');
      expect(clean).toContain('<div>Best,<br>Alex</div>');
    });

    it('strips inline event handlers', () => {
      const xss = '<img src="avatar.png" onload="evilCode()" onerror="steal()" alt="Avatar" />';
      const clean = sanitizeSignatureHtml(xss);
      expect(clean).not.toContain('onload');
      expect(clean).not.toContain('onerror');
      expect(clean).toContain('src="avatar.png"');
    });

    it('handles empty or undefined input', () => {
      expect(sanitizeSignatureHtml('')).toBe('');
      expect(sanitizeSignatureHtml(undefined)).toBe('');
    });
  });

  describe('signatureHtmlToText', () => {
    it('converts basic HTML elements to plaintext', () => {
      const html = '<div dir="ltr"><p>Alex Smith<br>VP of Sales</p><p><a href="https://example.com">example.com</a></p></div>';
      const text = signatureHtmlToText(html);
      expect(text).toContain('Alex Smith\nVP of Sales');
      expect(text).toContain('example.com');
      expect(text).not.toContain('<div');
      expect(text).not.toContain('<p');
    });

    it('decodes common HTML entities', () => {
      const html = 'Done &amp; Better &lt;Tech&gt; &quot;Solutions&quot;&nbsp;LLC';
      const text = signatureHtmlToText(html);
      expect(text).toBe('Done & Better <Tech> "Solutions" LLC');
    });

    it('handles empty or undefined input', () => {
      expect(signatureHtmlToText('')).toBe('');
      expect(signatureHtmlToText(undefined)).toBe('');
    });
  });

  describe('appendSignatureToBody', () => {
    it('appends signature using standard RFC 3676 delimiter', () => {
      const body = 'Hi Jordan,\n\nFollowing up on our call.';
      const signature = 'Alex Smith\nVP of Sales\n555-0100';
      const result = appendSignatureToBody(body, signature);

      expect(result).toBe('Hi Jordan,\n\nFollowing up on our call.\n\n-- \nAlex Smith\nVP of Sales\n555-0100');
    });

    it('returns original body when signature is empty or whitespace', () => {
      const body = 'Hello world';
      expect(appendSignatureToBody(body, '')).toBe('Hello world');
      expect(appendSignatureToBody(body, '   \n  ')).toBe('Hello world');
      expect(appendSignatureToBody(body, undefined)).toBe('Hello world');
    });

    it('trims trailing whitespace before appending delimiter', () => {
      const body = 'Hello world   \n\n';
      const signature = 'Best,\nAlex';
      expect(appendSignatureToBody(body, signature)).toBe('Hello world\n\n-- \nBest,\nAlex');
    });
  });

  describe('fetchGmailSignatureFromGoogle', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('fetches sendAs settings and returns primary signature', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: 'other@example.com',
              isPrimary: false,
              signature: 'Other signature',
            },
            {
              sendAsEmail: 'alex@example.com',
              isPrimary: true,
              signature: '<b>Alex Smith</b><br>Sales Team',
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', fakeFetch);

      const result = await fetchGmailSignatureFromGoogle('mock-access-token', 'alex@example.com');
      expect(result).not.toBeNull();
      expect(result?.signatureHtml).toBe('<b>Alex Smith</b><br>Sales Team');
      expect(result?.signatureText).toBe('Alex Smith\nSales Team');

      expect(fakeFetch).toHaveBeenCalledWith(
        'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs',
        { headers: { Authorization: 'Bearer mock-access-token' } }
      );
    });

    it('returns null if Google API returns an error', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });
      vi.stubGlobal('fetch', fakeFetch);

      const result = await fetchGmailSignatureFromGoogle('invalid-token');
      expect(result).toBeNull();
    });
  });

  describe('syncUserGmailSignature', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns error if user connection is missing or not active', async () => {
      const fakeDb: any = {};
      vi.spyOn(integrationStore, 'getUserConnection').mockResolvedValue(null);

      const result = await syncUserGmailSignature(fakeDb, 'user-123');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('no_active_connection');
    });

    it('fetches signature and persists to integration_connections in DB', async () => {
      const fakeUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const fakeDb: any = {
        collection: vi.fn().mockReturnValue({
          updateOne: fakeUpdateOne,
        }),
      };

      vi.spyOn(integrationStore, 'getUserConnection').mockResolvedValue({
        id: 'conn-abc',
        provider: 'gmail',
        authMethod: 'oauth2',
        status: 'active',
        userEmail: 'alex@example.com',
        scopes: [],
        createdAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
        brand: 'default',
        tenantId: 'default',
      } as any);

      vi.spyOn(integrationStore, 'getValidCredential').mockResolvedValue('valid-access-token');

      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: 'alex@example.com',
              isPrimary: true,
              signature: '<div>Alex Smith</div><div>CEO</div>',
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', fakeFetch);

      const result = await syncUserGmailSignature(fakeDb, 'user-123');
      expect(result.ok).toBe(true);
      expect(result.signatureText).toBe('Alex Smith\nCEO');

      expect(fakeUpdateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = fakeUpdateOne.mock.calls[0];
      expect(filter).toEqual({ id: 'conn-abc' });
      expect(update.$set.signatureText).toBe('Alex Smith\nCEO');
      expect(update.$set.signatureSyncedAt).toBeDefined();
    });
  });
});
