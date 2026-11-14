import { describe, it, expect, vi, beforeEach } from 'vitest';

const resendSendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = {
      send: resendSendMock,
    };
  },
}));

import { sendLandingConfirmationEmail } from '@/lib/landing-confirmation-email';
import { createGoogleWalletSaveUrl, isGoogleWalletConfigured } from '@/lib/google-wallet';

describe('Landing Confirmation Email & Passes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resendSendMock.mockReset();
  });

  describe('sendLandingConfirmationEmail', () => {
    it('returns sent: false gracefully when RESEND_API_KEY is missing', async () => {
      delete process.env.RESEND_API_KEY;

      const result = await sendLandingConfirmationEmail({
        brand: 'vegas',
        brandLabel: 'Mr Vegas',
        campaign: 'grand-slam-of-darts',
        campaignTitle: 'Mr Vegas Grand Slam of Darts',
        recipientEmail: 'test@example.com',
        recipientName: 'Csaba Moldovan',
      });

      expect(result.sent).toBe(false);
      expect(result.error).toBe('RESEND_API_KEY not configured');
    });

    it('rejects invalid recipient email formats', async () => {
      process.env.RESEND_API_KEY = 're_test_123';

      const result = await sendLandingConfirmationEmail({
        brand: 'vegas',
        recipientEmail: 'invalid-email',
        recipientName: 'Test User',
      });

      expect(result.sent).toBe(false);
      expect(result.error).toBe('Invalid recipient email');
    });

    it('falls back to the verified brand@outbound domain when custom fromEmail domain is rejected by Resend', async () => {
      process.env.RESEND_API_KEY = 're_test_123';
      delete process.env.RESEND_OUTBOUND_DOMAIN;
      resendSendMock
        .mockResolvedValueOnce({
          data: null,
          error: { name: 'validation_error', message: 'The mrvegas.com domain is not verified.' },
        })
        .mockResolvedValueOnce({
          data: { id: 're_msg_fallback' },
          error: null,
        });

      const result = await sendLandingConfirmationEmail({
        brand: 'vegas',
        recipientEmail: 'fan@example.com',
        recipientName: 'Csaba Moldovan',
        fromEmail: 'office@mrvegas.com',
      });

      expect(result).toEqual({ sent: true, messageId: 're_msg_fallback' });
      expect(resendSendMock).toHaveBeenCalledTimes(2);
      expect(resendSendMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ from: 'office@mrvegas.com' })
      );
      expect(resendSendMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ from: 'vegas@haho.ai', replyTo: 'office@mrvegas.com' })
      );
    });

    it('returns sent: false when Resend returns an API error on the fallback sender', async () => {
      process.env.RESEND_API_KEY = 're_test_123';
      resendSendMock.mockResolvedValueOnce({
        data: null,
        error: { name: 'validation_error', message: 'Domain not verified' },
      });

      const result = await sendLandingConfirmationEmail({
        brand: 'vegas',
        recipientEmail: 'fan@example.com',
        recipientName: 'Csaba Moldovan',
      });

      expect(result).toEqual({ sent: false, error: 'Domain not verified' });
    });
  });

  describe('Google Wallet generator', () => {
    it('correctly reports unconfigured state when environment keys are absent', () => {
      delete process.env.GOOGLE_WALLET_ISSUER_ID;
      delete process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL;
      delete process.env.GOOGLE_WALLET_PRIVATE_KEY;

      expect(isGoogleWalletConfigured()).toBe(false);
      const url = createGoogleWalletSaveUrl({
        name: 'Csaba Moldovan',
        eventName: 'Mr Vegas Grand Slam of Darts',
        email: 'csaba@example.com',
      });
      expect(url).toBeNull();
    });
  });
});
