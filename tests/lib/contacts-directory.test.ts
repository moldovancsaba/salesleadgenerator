import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregateContactsAcrossLeads } from '../../lib/contacts';
import { queryContactsDirectory } from '../../lib/contacts-directory';

function buildLeads(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `lead-${i}`,
    entity_name: `Org ${i}`,
    contacts: [
      {
        name: `Person ${String(i).padStart(5, '0')}`,
        email: `p${i}@example.com`,
        phone: i % 2 === 0 ? '+3612345678' : '',
      },
    ],
  }));
}

describe('contacts directory totals and paging (issue 355)', () => {
  const all = aggregateContactsAcrossLeads(buildLeads(5600));

  it('reports exact totals beyond 99, 500 and the former 5,000-lead cap', () => {
    const res = queryContactsDirectory(all, { page: 1, pageSize: 100 });
    expect(res.totalContacts).toBe(5600);
    expect(res.filteredCount).toBe(5600);
    expect(res.totalPages).toBe(56);
    expect(res.contacts).toHaveLength(100);
  });

  it('reaches and searches the very last contact', () => {
    const last = queryContactsDirectory(all, { page: 56, pageSize: 100 });
    expect(last.contacts[last.contacts.length - 1].name).toBe('Person 05599');

    const found = queryContactsDirectory(all, { q: 'person 05599' });
    expect(found.filteredCount).toBe(1);
    expect(found.totalContacts).toBe(5600);
  });

  it('keeps paging stable and non-overlapping, and clamps out-of-range pages', () => {
    const p1 = queryContactsDirectory(all, { page: 1, pageSize: 250 }).contacts.map((c) => c.key);
    const p2 = queryContactsDirectory(all, { page: 2, pageSize: 250 }).contacts.map((c) => c.key);
    expect(new Set([...p1, ...p2]).size).toBe(500);
    expect(queryContactsDirectory(all, { page: 9999, pageSize: 250 }).page).toBe(23);
  });

  it('applies phone filter before counting and paging', () => {
    const res = queryContactsDirectory(all, { phoneOnly: true, page: 1, pageSize: 100 });
    expect(res.filteredCount).toBe(2800);
    expect(res.totalContacts).toBe(5600);
  });

  it('wires the API and client to exact counts without the 99+ cap or lead limit', () => {
    const root = process.cwd();
    const route = readFileSync(join(root, 'app', 'api', 'contacts', 'route.ts'), 'utf8');
    expect(route).not.toContain('Math.min(5000');
    expect(route).toContain('totalContacts');
    const client = readFileSync(join(root, 'app', 'contacts', '[brand]', 'contacts-client.tsx'), 'utf8');
    expect(client).toContain('cap={Number.MAX_SAFE_INTEGER}');
    expect(client).toContain('<Pagination');
  });
});
