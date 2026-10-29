import { describe, it, expect } from 'vitest';
import { normalizePhoneForMessaging, buildWhatsAppUrl, buildIMessageUrl } from '../../lib/messaging-urls';

describe('messaging-urls', () => {
  describe('normalizePhoneForMessaging', () => {
    it('normalizes international numbers with plus prefix and spaces', () => {
      expect(normalizePhoneForMessaging('+27 72 188 5925')).toBe('27721885925');
      expect(normalizePhoneForMessaging('+212-677-885017')).toBe('212677885017');
    });

    it('handles numbers with 00 international prefix', () => {
      expect(normalizePhoneForMessaging('0033 6 72 98 35 84')).toBe('33672983584');
    });

    it('returns empty string on empty or invalid input', () => {
      expect(normalizePhoneForMessaging('')).toBe('');
      expect(normalizePhoneForMessaging('abc')).toBe('');
      expect(normalizePhoneForMessaging(null as any)).toBe('');
    });
  });

  describe('buildWhatsAppUrl', () => {
    it('builds valid click-to-chat URL', () => {
      expect(buildWhatsAppUrl('+27 72 188 5925')).toBe('https://wa.me/27721885925');
    });

    it('includes encoded pre-filled text if provided', () => {
      const url = buildWhatsAppUrl('+27 72 188 5925', 'Hello from Padel Africa!');
      expect(url).toBe('https://wa.me/27721885925?text=Hello%20from%20Padel%20Africa!');
    });

    it('returns empty string if phone has no digits', () => {
      expect(buildWhatsAppUrl('')).toBe('');
    });
  });

  describe('buildIMessageUrl', () => {
    it('builds standard sms: scheme for iMessage/SMS', () => {
      expect(buildIMessageUrl('+212 677 885 017')).toBe('sms:212677885017');
    });

    it('includes pre-filled message body when supplied', () => {
      const url = buildIMessageUrl('+212 677 885 017', 'Quick follow up');
      expect(url).toBe('sms:212677885017&body=Quick%20follow%20up');
    });

    it('returns empty string if phone has no digits', () => {
      expect(buildIMessageUrl('')).toBe('');
    });
  });
});
