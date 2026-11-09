import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendLandingConfirmationEmail } from '@/lib/landing-confirmation-email';
import { createGoogleWalletSaveUrl, isGoogleWalletConfigured } from '@/lib/google-wallet';

describe('Landing Confirmation Email & Passes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
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
