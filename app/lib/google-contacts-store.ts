import type { Db } from 'mongodb';
import { getActiveConnectionByProvider, getValidCredential, ConnectionRevokedError } from './integration-store';
import { fetchWithRetry } from '../../lib/integration-http';
import type { Brand } from './brand';

const PEOPLE_API_BASE = 'https://people.googleapis.com/v1';
const READ_MASK = 'names,emailAddresses,phoneNumbers,organizations';
const SEARCH_PAGE_SIZE = 25;

export type GoogleContactResult = {
  resourceName: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
};

function mapPerson(person: any): GoogleContactResult | null {
  if (!person?.resourceName) return null;
  const name = person.names?.[0]?.displayName;
  if (!name) return null;
  return {
    resourceName: person.resourceName,
    name,
    email: person.emailAddresses?.[0]?.value,
    phone: person.phoneNumbers?.[0]?.value,
    organization: person.organizations?.[0]?.name,
  };
}

export type ContactsAccessResult =
  | { ok: true; token: string }
  | { ok: false; status: 404 | 503; error: string };

async function resolveContactsAccess(db: Db, brand: Brand, tenantId: string): Promise<ContactsAccessResult> {
  const connection = await getActiveConnectionByProvider(db, brand, tenantId, 'google_contacts');
  if (!connection) return { ok: false, status: 404, error: 'Google Contacts is not connected for this brand' };
  try {
    const token = await getValidCredential(db, connection);
    return { ok: true, token };
  } catch (error) {
    const reason = error instanceof ConnectionRevokedError ? error.message : 'Google Contacts connection needs to be reconnected';
    return { ok: false, status: 503, error: reason };
  }
}

// Issue 216 §10, enhanced in Issue 251:
// - When query is non-empty: uses People API's people:searchContacts
// - When query is empty/omitted: uses People API's people/me/connections
//   (sorted by LAST_MODIFIED_DESCENDING) to display recent contacts.
export async function searchGoogleContacts(db: Db, brand: Brand, tenantId: string, query?: string): Promise<ContactsAccessResult & { results?: GoogleContactResult[] }> {
  const access = await resolveContactsAccess(db, brand, tenantId);
  if (!access.ok) return access;

  const trimmedQuery = (query || '').trim();
  let url: URL;
  if (!trimmedQuery) {
    url = new URL(`${PEOPLE_API_BASE}/people/me/connections`);
    url.searchParams.set('personFields', READ_MASK);
    url.searchParams.set('pageSize', String(SEARCH_PAGE_SIZE));
    url.searchParams.set('sortOrder', 'LAST_MODIFIED_DESCENDING');
  } else {
    url = new URL(`${PEOPLE_API_BASE}/people:searchContacts`);
    url.searchParams.set('query', trimmedQuery);
    url.searchParams.set('readMask', READ_MASK);
    url.searchParams.set('pageSize', String(SEARCH_PAGE_SIZE));
  }

  const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${access.token}` } });
  if (!res.ok) return { ok: false, status: 503, error: 'Could not reach Google Contacts' };
  const body = await res.json();
  const rawList = trimmedQuery ? (body.results || []).map((r: any) => r.person) : (body.connections || []);
  const results = rawList
    .map((p: any) => mapPerson(p))
    .filter((c: GoogleContactResult | null): c is GoogleContactResult => c !== null);
  return { ok: true, token: access.token, results };
}

// Issue #216 Algorithm B — fetches one contact by resourceName for import.
export async function getGoogleContact(db: Db, brand: Brand, tenantId: string, resourceName: string): Promise<ContactsAccessResult & { contact?: GoogleContactResult }> {
  const access = await resolveContactsAccess(db, brand, tenantId);
  if (!access.ok) return access;

  const url = new URL(`${PEOPLE_API_BASE}/${resourceName}`);
  url.searchParams.set('personFields', READ_MASK);

  const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${access.token}` } });
  if (!res.ok) return { ok: false, status: 503, error: 'Could not reach Google Contacts' };
  const person = await res.json();
  const contact = mapPerson(person);
  if (!contact) return { ok: false, status: 503, error: 'This contact has no name and cannot be imported' };
  return { ok: true, token: access.token, contact };
}
