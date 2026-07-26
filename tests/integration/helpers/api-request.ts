import { NextRequest } from 'next/server';

// Issue #104: every core lead route now requires either a valid x-api-key
// or a valid SSO session with brand access (lib/require-brand-access-api.ts).
// These integration tests exercise business logic, not auth, and have no
// way to mint a real signed SSO JWT in this sandbox — so they authenticate
// via the API-key branch instead, same as the app's own documented
// machine-to-machine integrations.
export const TEST_API_KEY = 'integration-test-key';
process.env.SLG_API_KEY = TEST_API_KEY;

export function buildApiRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  const headers = new Headers(init?.headers);
  if (!headers.has('x-api-key')) {
    headers.set('x-api-key', TEST_API_KEY);
  }
  return new NextRequest(`http://localhost${url}`, { ...init, headers });
}
