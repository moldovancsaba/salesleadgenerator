import type { EncryptedBlob } from './integration-crypto';

// Third-party integration connection hub (issue #217) — shared data model
// and provider registry every specific integration (Google Calendar, Gmail,
// Google Contacts, Calendly, and whatever is added later) plugs into,
// instead of each one inventing its own credential-storage design.

export type IntegrationProvider = 'google_calendar' | 'gmail' | 'google_contacts' | 'calendly';
export type IntegrationAuthMethod = 'oauth2' | 'api_key';
export type IntegrationStatus = 'active' | 'expired' | 'revoked' | 'error';

export type IntegrationConnection = {
  id: string;
  brand: string;
  tenantId: string;
  provider: IntegrationProvider;
  authMethod: IntegrationAuthMethod;
  // Modelled as one encrypted JSON blob (oauth2: {accessToken, refreshToken};
  // api_key: {apiKey}) rather than separate accessTokenEncrypted/
  // refreshTokenEncrypted/tokenIv fields, so one collection/shape serves
  // both auth methods without provider-specific optional-field sprawl.
  encryptedCredentials: EncryptedBlob;
  providerAccountLabel?: string; // display only, never used for auth decisions
  scopes?: string[]; // oauth2 only
  accessTokenExpiresAt?: string; // oauth2 only, ISO
  connectedBy: string; // ssoUserId of the admin who performed the connect
  connectedAt: string; // ISO
  lastVerifiedAt?: string; // ISO, set by connect and by the Test action
  status: IntegrationStatus;
  lastSyncError?: string;
  updatedAt: string;
  revokedAt?: string | null;
};

export const OAUTH_PROVIDERS: IntegrationProvider[] = ['google_calendar', 'gmail', 'google_contacts'];
export const API_KEY_PROVIDERS: IntegrationProvider[] = ['calendly'];
export const ALL_PROVIDERS: IntegrationProvider[] = [...OAUTH_PROVIDERS, ...API_KEY_PROVIDERS];

export function isKnownProvider(value: unknown): value is IntegrationProvider {
  return typeof value === 'string' && (ALL_PROVIDERS as string[]).includes(value);
}

export function isOAuthProvider(provider: IntegrationProvider): boolean {
  return (OAUTH_PROVIDERS as string[]).includes(provider);
}

export function authMethodForProvider(provider: IntegrationProvider): IntegrationAuthMethod {
  return isOAuthProvider(provider) ? 'oauth2' : 'api_key';
}

type OAuthProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  tokenInfoUrl: string;
  scopes: string[];
};

type ApiKeyProviderConfig = {
  verifyUrl: string;
};

// Endpoints verified against each provider's real, published OAuth2/REST
// documentation (Google's documented endpoints; Calendly's real, live
// OpenAPI spec) rather than assumed, per CLAUDE.md Rule 5. Google's family
// shares one client registration (GOOGLE_OAUTH_CLIENT_ID/_SECRET/_REDIRECT_URI,
// one env var set for the whole app, not per-provider) and one token/revoke
// endpoint — only the requested scopes differ per provider.
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
// tokeninfo (not the Bearer-header userinfo endpoint) is used for the Test
// action deliberately: it validates the token itself against ANY scope,
// where userinfo requires openid/profile/email scope this app deliberately
// never requests (least-privilege, issue #217 §17) and would 403 a
// perfectly valid calendar-only token.
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

export const OAUTH_PROVIDER_CONFIG: Record<'google_calendar' | 'gmail' | 'google_contacts', OAuthProviderConfig> = {
  google_calendar: {
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    revokeUrl: GOOGLE_REVOKE_URL,
    tokenInfoUrl: GOOGLE_TOKENINFO_URL,
    scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'],
  },
  gmail: {
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    revokeUrl: GOOGLE_REVOKE_URL,
    tokenInfoUrl: GOOGLE_TOKENINFO_URL,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  },
  google_contacts: {
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    revokeUrl: GOOGLE_REVOKE_URL,
    tokenInfoUrl: GOOGLE_TOKENINFO_URL,
    scopes: ['https://www.googleapis.com/auth/contacts.readonly'],
  },
};

// Personal access token, not OAuth — Calendly's own published guidance
// ("use personal access tokens if you need to securely share data from
// your...Calendly account with an internal or private application that's
// not for use by others outside of your company") is the correct v1 fit
// for this hub's small, fixed, internal-admin use case, verified against
// Calendly's real, live OpenAPI spec (securitySchemes.personal_access_token:
// { type: http, scheme: bearer }).
export const API_KEY_PROVIDER_CONFIG: Record<'calendly', ApiKeyProviderConfig> = {
  calendly: {
    verifyUrl: 'https://api.calendly.com/users/me',
  },
};

export function oauthConfigFor(provider: IntegrationProvider): OAuthProviderConfig | null {
  if (!isOAuthProvider(provider)) return null;
  return OAUTH_PROVIDER_CONFIG[provider as 'google_calendar' | 'gmail' | 'google_contacts'];
}

export function apiKeyConfigFor(provider: IntegrationProvider): ApiKeyProviderConfig | null {
  if (isOAuthProvider(provider)) return null;
  return API_KEY_PROVIDER_CONFIG[provider as 'calendly'];
}

export function buildGoogleAuthorizeUrl(params: {
  provider: 'google_calendar' | 'gmail' | 'google_contacts';
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const cfg = OAUTH_PROVIDER_CONFIG[params.provider];
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // access_type=offline + prompt=consent guarantees a refresh_token on
  // every connect/reconnect — without prompt=consent, Google only issues a
  // refresh_token on a user's very first-ever grant to this client, which
  // would silently break Reconnect for anyone who already granted once.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  google_calendar: 'Google Calendar',
  gmail: 'Gmail',
  google_contacts: 'Google Contacts',
  calendly: 'Calendly',
};
