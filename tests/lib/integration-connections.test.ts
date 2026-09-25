import { describe, it, expect } from 'vitest';
import {
  ALL_PROVIDERS, OAUTH_PROVIDERS, API_KEY_PROVIDERS, isKnownProvider, isOAuthProvider,
  authMethodForProvider, oauthConfigFor, apiKeyConfigFor, buildGoogleAuthorizeUrl, PROVIDER_LABELS,
} from '../../lib/integration-connections';

describe('provider registry (issue 217)', () => {
  it('every provider has exactly one auth method family', () => {
    for (const provider of ALL_PROVIDERS) {
      expect(OAUTH_PROVIDERS.includes(provider) !== API_KEY_PROVIDERS.includes(provider)).toBe(true);
    }
  });

  it('every provider has a display label', () => {
    for (const provider of ALL_PROVIDERS) {
      expect(PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });

  it('isKnownProvider rejects an unrecognized string', () => {
    expect(isKnownProvider('microsoft_365')).toBe(false);
    expect(isKnownProvider('')).toBe(false);
    expect(isKnownProvider(undefined)).toBe(false);
  });

  it('isKnownProvider accepts every real provider', () => {
    for (const provider of ALL_PROVIDERS) expect(isKnownProvider(provider)).toBe(true);
  });

  it('isOAuthProvider is true only for the Google family', () => {
    expect(isOAuthProvider('google_calendar')).toBe(true);
    expect(isOAuthProvider('gmail')).toBe(true);
    expect(isOAuthProvider('google_contacts')).toBe(true);
    expect(isOAuthProvider('calendly')).toBe(false);
  });

  it('authMethodForProvider matches the provider family', () => {
    expect(authMethodForProvider('google_calendar')).toBe('oauth2');
    expect(authMethodForProvider('calendly')).toBe('api_key');
  });
});

describe('oauthConfigFor / apiKeyConfigFor (issue 217)', () => {
  it('oauthConfigFor returns null for an api_key provider', () => {
    expect(oauthConfigFor('calendly')).toBeNull();
  });

  it('apiKeyConfigFor returns null for an oauth2 provider', () => {
    expect(apiKeyConfigFor('google_calendar')).toBeNull();
  });

  it('google_calendar requests only calendar.events and calendar.freebusy — least privilege, not a broad scope', () => {
    const cfg = oauthConfigFor('google_calendar')!;
    expect(cfg.scopes).toEqual([
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy',
    ]);
  });

  it('every oauth2 provider shares the same Google token/revoke/tokeninfo endpoints', () => {
    const calendar = oauthConfigFor('google_calendar')!;
    const gmail = oauthConfigFor('gmail')!;
    const contacts = oauthConfigFor('google_contacts')!;
    expect(gmail.tokenUrl).toBe(calendar.tokenUrl);
    expect(contacts.tokenUrl).toBe(calendar.tokenUrl);
    expect(gmail.revokeUrl).toBe(calendar.revokeUrl);
  });

  it('calendly verifies against the real GET /users/me endpoint', () => {
    expect(apiKeyConfigFor('calendly')!.verifyUrl).toBe('https://api.calendly.com/users/me');
  });
});

describe('buildGoogleAuthorizeUrl (issue 217)', () => {
  it('builds a real Google authorize URL with PKCE S256, offline access, and forced consent', () => {
    const url = buildGoogleAuthorizeUrl({
      provider: 'google_calendar',
      clientId: 'client-123',
      redirectUri: 'https://salesleadgenerator.vercel.app/api/integrations/oauth/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://salesleadgenerator.vercel.app/api/integrations/oauth/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('encodes the provider-specific scope list as a space-joined string', () => {
    const url = buildGoogleAuthorizeUrl({
      provider: 'gmail',
      clientId: 'c',
      redirectUri: 'https://example.com/callback',
      state: 's',
      codeChallenge: 'cc',
    });
    const scope = new URL(url).searchParams.get('scope');
    expect(scope).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
  });
});
