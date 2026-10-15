import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  encodeBase64Url,
  formatMailbox,
  generateMessageId,
  buildRfc2822Message,
  sendGmailMessage,
} from '../../lib/gmail-send';

describe('gmail-send (Issue 248)', () => {
  describe('encodeBase64Url', () => {
    it('encodes a string to standard base64url without padding', () => {
      // "Hello World" -> base64 "SGVsbG8gV29ybGQ=" -> base64url "SGVsbG8gV29ybGQ"
      expect(encodeBase64Url('Hello World')).toBe('SGVsbG8gV29ybGQ');
    });

    it('replaces + with - and / with _', () => {
      // Buffer with bytes that produce + and /
      const buf = Buffer.from([251, 239]); // base64 is ++8= -> base64url --8
      expect(encodeBase64Url(buf)).toBe('--8');
    });

    it('handles empty input cleanly', () => {
      expect(encodeBase64Url('')).toBe('');
    });
  });

  describe('formatMailbox', () => {
    it('formats a person with name and email', () => {
      expect(formatMailbox({ name: 'Jane Doe', email: 'jane@example.com' })).toBe('"Jane Doe" <jane@example.com>');
    });

    it('strips quotes and newlines from name', () => {
      expect(formatMailbox({ name: 'Jane "Boss"\nDoe', email: 'jane@example.com' })).toBe('"Jane BossDoe" <jane@example.com>');
    });

    it('returns bare email if name is missing or empty', () => {
      expect(formatMailbox({ email: 'jane@example.com' })).toBe('jane@example.com');
      expect(formatMailbox({ name: '   ', email: 'jane@example.com' })).toBe('jane@example.com');
    });
  });

  describe('generateMessageId', () => {
    it('generates a formatted messageId using sender domain', () => {
      const msgId = generateMessageId('jane@salesrep.company.com');
      expect(msgId).toMatch(/^<slg-\d+-[a-z0-9]+@salesrep\.company\.com>$/);
    });

    it('falls back to slg.internal if domain is missing', () => {
      const msgId = generateMessageId('invalidemail');
      expect(msgId).toMatch(/^<slg-\d+-[a-z0-9]+@slg\.internal>$/);
    });
  });

  describe('buildRfc2822Message', () => {
    it('constructs standard RFC 2822 MIME message with all headers and body', () => {
      const fixedDate = new Date('2026-10-14T10:00:00.000Z');
      const { messageText, messageId } = buildRfc2822Message({
        from: { name: 'Alex Rep', email: 'alex@company.com' },
        to: { name: 'Jordan Lead', email: 'jordan@prospect.com' },
        subject: 'Quick question about CRM',
        bodyText: 'Hi Jordan,\n\nHope this finds you well.\nBest, Alex',
        date: fixedDate,
      });

      expect(messageId).toMatch(/^<slg-\d+-[a-z0-9]+@company\.com>$/);
      expect(messageText).toContain('From: "Alex Rep" <alex@company.com>');
      expect(messageText).toContain('To: "Jordan Lead" <jordan@prospect.com>');
      expect(messageText).toContain('Subject: Quick question about CRM');
      expect(messageText).toContain(`Date: ${fixedDate.toUTCString()}`);
      expect(messageText).toContain(`Message-ID: ${messageId}`);
      expect(messageText).toContain('MIME-Version: 1.0');
      expect(messageText).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(messageText).toContain('Hi Jordan,\r\n\r\nHope this finds you well.\r\nBest, Alex');
    });

    it('includes In-Reply-To and References when replying to a thread', () => {
      const { messageText } = buildRfc2822Message({
        from: { email: 'alex@company.com' },
        to: { email: 'jordan@prospect.com' },
        subject: 'Re: Previous conversation',
        bodyText: 'Follow up',
        inReplyTo: '<parent-123@prospect.com>',
        references: '<root-001@prospect.com> <parent-123@prospect.com>',
      });

      expect(messageText).toContain('In-Reply-To: <parent-123@prospect.com>');
      expect(messageText).toContain('References: <root-001@prospect.com> <parent-123@prospect.com>');
    });
  });

  describe('sendGmailMessage', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('posts encoded raw MIME to Gmail messages.send endpoint', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'gmail-msg-999', threadId: 'gmail-th-111' }),
      });
      vi.stubGlobal('fetch', fakeFetch);

      const result = await sendGmailMessage({
        accessToken: 'test-oauth-access-token',
        rawMime: 'From: me@company.com\r\n\r\nTest body',
        threadId: 'gmail-th-111',
      });

      expect(result).toEqual({ id: 'gmail-msg-999', threadId: 'gmail-th-111' });
      expect(fakeFetch).toHaveBeenCalledTimes(1);

      const [url, options] = fakeFetch.mock.calls[0];
      expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        Authorization: 'Bearer test-oauth-access-token',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(options.body);
      expect(body.threadId).toBe('gmail-th-111');
      expect(body.raw).toBe(encodeBase64Url('From: me@company.com\r\n\r\nTest body'));
    });

    it('throws error with API error message when send fails', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Insufficient Permission: gmail.send required' } }),
      });
      vi.stubGlobal('fetch', fakeFetch);

      await expect(
        sendGmailMessage({
          accessToken: 'bad-token',
          rawMime: 'test',
        })
      ).rejects.toThrow('Insufficient Permission: gmail.send required');
    });
  });
});
