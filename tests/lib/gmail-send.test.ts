import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  encodeBase64Url,
  encodeRfc2047,
  encodeQuotedPrintable,
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

  describe('encodeRfc2047', () => {
    it('returns empty string for empty input', () => {
      expect(encodeRfc2047('')).toBe('');
    });

    it('leaves pure printable US-ASCII text unchanged', () => {
      expect(encodeRfc2047('Quick question about CRM')).toBe('Quick question about CRM');
    });

    it('encodes Hungarian accented display names without exceeding word length limits', () => {
      const encoded = encodeRfc2047('Moldován Csaba');
      expect(encoded).toBe('=?UTF-8?B?TW9sZG92w6FuIENzYWJh?=');
      // Verify decodability back to original
      const b64 = encoded.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, '');
      expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('Moldován Csaba');
    });

    it('encodes another accented name like Dávid Bozsik', () => {
      const encoded = encodeRfc2047('Dávid Bozsik');
      expect(encoded).toBe('=?UTF-8?B?RMOhdmlkIEJvenNpaw==?=');
    });

    it('splits long strings into multiple encoded-words <= 75 chars', () => {
      const longSubject = 'A very long subject line with Hungarian characters: ' + 'Árvíztűrő tükörfúrógép! '.repeat(5);
      const encoded = encodeRfc2047(longSubject);
      const words = encoded.split(' ');
      for (const w of words) {
        expect(w.length).toBeLessThanOrEqual(75);
        expect(w.startsWith('=?UTF-8?B?')).toBe(true);
        expect(w.endsWith('?=')).toBe(true);
      }
      // Decode roundtrip
      let decoded = encoded.replace(/(=\?UTF-8\?B\?[^\?]+\?=)\s+(?==\?UTF-8\?B\?[^\?]+\?=)/gi, '$1');
      decoded = decoded.replace(/=\?UTF-8\?B\?([^\?]+)\?=/gi, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));
      expect(decoded).toBe(longSubject);
    });
  });

  describe('encodeQuotedPrintable', () => {
    it('returns empty string for empty input', () => {
      expect(encodeQuotedPrintable('')).toBe('');
    });

    it('leaves printable ASCII lines unchanged', () => {
      const plain = 'Hello world, this is a plain message.';
      expect(encodeQuotedPrintable(plain)).toBe(plain);
    });

    it('encodes "=" character as =3D', () => {
      expect(encodeQuotedPrintable('a = b')).toBe('a =3D b');
    });

    it('encodes trailing spaces and tabs on a line', () => {
      const text = 'hello   \nworld\t';
      const encoded = encodeQuotedPrintable(text);
      expect(encoded).toBe('hello=20=20=20\r\nworld=09');
    });

    it('encodes multi-byte UTF-8 characters as uppercase hex octets', () => {
      const hungarian = 'Köszönöm a beszélgetést! ű és ő';
      const encoded = encodeQuotedPrintable(hungarian);
      expect(encoded).toContain('=C3=B6'); // ö
      expect(encoded).toContain('=C5=B1'); // ű
      expect(encoded).toContain('=C5=91'); // ő
      expect(encoded).toContain('=C3=A9'); // é
    });

    it('wraps long lines exceeding 76 chars with soft line breaks', () => {
      const longLine = 'a'.repeat(100);
      const encoded = encodeQuotedPrintable(longLine);
      const lines = encoded.split('\r\n');
      expect(lines.length).toBe(2);
      expect(lines[0].endsWith('=')).toBe(true);
      expect(lines[0].length).toBeLessThanOrEqual(76);
      expect(lines[1].length).toBeLessThanOrEqual(76);
    });
  });

  describe('formatMailbox', () => {
    it('formats a person with name and email', () => {
      expect(formatMailbox({ name: 'Jane Doe', email: 'jane@example.com' })).toBe('"Jane Doe" <jane@example.com>');
    });

    it('strips quotes and newlines from name', () => {
      expect(formatMailbox({ name: 'Jane "Boss"\nDoe', email: 'jane@example.com' })).toBe('"Jane BossDoe" <jane@example.com>');
    });

    it('encodes non-ASCII names using RFC 2047 without surrounding quotes', () => {
      expect(formatMailbox({ name: 'Moldován Csaba', email: 'moldovancsaba@gmail.com' }))
        .toBe('=?UTF-8?B?TW9sZG92w6FuIENzYWJh?= <moldovancsaba@gmail.com>');
      expect(formatMailbox({ name: 'Dávid Bozsik', email: 'david@example.com' }))
        .toBe('=?UTF-8?B?RMOhdmlkIEJvenNpaw==?= <david@example.com>');
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
      expect(messageText).toContain('Content-Transfer-Encoding: quoted-printable');
      expect(messageText).toContain('Hi Jordan,\r\n\r\nHope this finds you well.\r\nBest, Alex');
    });

    it('encodes non-ASCII sender, recipient, subject, and body using RFC 2047 and quoted-printable', () => {
      const fixedDate = new Date('2026-10-14T10:00:00.000Z');
      const { messageText } = buildRfc2822Message({
        from: { name: 'Moldován Csaba', email: 'moldovancsaba@gmail.com' },
        to: { name: 'Dávid Bozsik', email: 'david@example.com' },
        subject: 'Köszönöm a beszélgetést!',
        bodyText: 'Kedves Dávid,\n\nNagyon örülök a megkeresésnek! Árvíztűrő tükörfúrógép.\n\nÜdvözlettel:\nCsaba',
        date: fixedDate,
      });

      // From and To use RFC 2047 encoded-word format without double quotes
      expect(messageText).toContain('From: =?UTF-8?B?TW9sZG92w6FuIENzYWJh?= <moldovancsaba@gmail.com>');
      expect(messageText).toContain('To: =?UTF-8?B?RMOhdmlkIEJvenNpaw==?= <david@example.com>');

      // Subject uses RFC 2047 encoded-word format
      expect(messageText).toContain('Subject: =?UTF-8?B?S8O2c3rDtm7Dtm0gYSBiZXN6w6lsZ2V0w6lzdCE=?=');

      // Body uses quoted-printable with hex UTF-8 bytes
      expect(messageText).toContain('Content-Transfer-Encoding: quoted-printable');
      expect(messageText).toContain('D=C3=A1vid'); // Dávid
      expect(messageText).toContain('=C3=B6r=C3=BCl=C3=B6k'); // örülök
      expect(messageText).toContain('megkeres=C3=A9snek'); // megkeresésnek
      expect(messageText).toContain('=C5=B1'); // ű
      expect(messageText).toContain('=C5=91'); // ő
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

    it('retries without threadId when Google rejects with 404 Requested entity was not found', async () => {
      let callCount = 0;
      const fakeFetch = vi.fn().mockImplementation(async (_url, options) => {
        callCount++;
        const parsedBody = JSON.parse(options.body);
        if (callCount === 1) {
          // First attempt with threadId fails with 404
          expect(parsedBody.threadId).toBe('invalid-or-foreign-thread-id');
          return {
            ok: false,
            status: 404,
            json: async () => ({ error: { code: 404, message: 'Requested entity was not found.' } }),
          };
        }
        // Second attempt without threadId succeeds
        expect(parsedBody.threadId).toBeUndefined();
        return {
          ok: true,
          json: async () => ({ id: 'new-msg-123', threadId: 'new-th-456' }),
        };
      });
      vi.stubGlobal('fetch', fakeFetch);

      const result = await sendGmailMessage({
        accessToken: 'valid-token',
        rawMime: 'From: me@company.com\r\n\r\nTest body',
        threadId: 'invalid-or-foreign-thread-id',
      });

      expect(result).toEqual({ id: 'new-msg-123', threadId: 'new-th-456' });
      expect(fakeFetch).toHaveBeenCalledTimes(2);
    });
  });
});
