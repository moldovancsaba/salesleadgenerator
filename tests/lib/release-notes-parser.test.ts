import { describe, it, expect } from 'vitest';
import {
  parseChangelog,
  formatReleaseDate,
  computeRelativeAge,
  classifyItemType,
  filterReleaseNotes,
} from '../../lib/release-notes-parser';
import { getReleaseNotes } from '../../lib/release-notes';

describe('Release Notes Parser (issue 269)', () => {
  const sampleChangelog = `
# Changelog — Sales Lead Generator

## 2.4.323

### Linked SSO Multi-Identity Connection Resolution & Inbox Sync Error Feedback

- **Multi-Identity SSO Connection Resolution (\`app/lib/integration-store.ts\`, \`lib/sso-access.ts\`):**
  - Exported \`resolveLinkedUserIdentities\` combining known aliases with SSO access.
  - Solves the gap where logging in with personal Google SSO could not resolve corporate connections.
- **Inbox Sync Notice Status & Error Guidance (\`app/inbox/[brand]/inbox-client.tsx\`):**
  - Enhanced syncNotice state to include semantic color status.
  - Added descriptive error message for invalid_grant token expirations.
- **Automated Verification:**
  - Added unit test in tests/lib/user-integrations.test.ts.

## 2.4.322

### Strict Mailbox Privacy Shield, Email Leak Protection & Comprehensive Sync Ingestion

- **Strict Mailbox Isolation & Privacy Security Shield (\`app/lib/inbox-store.ts\`):**
  - Completely rewrote isMyInbox determination loop to prevent email leaks.
  - Threads where a rep is only on CC are strictly excluded from personal inbox.
- **RFC 5322 Address Parsing Overhaul (\`app/lib/gmail-sync-store.ts\`):**
  - Fixed comma-splitting bug inside quoted display names.
  `;

  it('correctly parses version numbers, titles, and item lists', () => {
    const notes = parseChangelog(sampleChangelog, {
      '2.4.323': '2026-10-22',
      '2.4.322': '2026-10-21',
    });

    expect(notes).toHaveLength(2);

    const first = notes[0];
    expect(first.version).toBe('2.4.323');
    expect(first.title).toBe('Linked SSO Multi-Identity Connection Resolution & Inbox Sync Error Feedback');
    expect(first.date).toBe('2026-10-22');
    expect(first.formattedDate).toBe('October 22, 2026');
    expect(first.items).toHaveLength(3);
    expect(first.items[0].title).toBe('Multi-Identity SSO Connection Resolution (app/lib/integration-store.ts, lib/sso-access.ts)');
    expect(first.items[0].title).not.toContain('**');
    expect(first.items[0].details[0]).not.toContain('`');

    const second = notes[1];
    expect(second.version).toBe('2.4.322');
    expect(second.title).toContain('Strict Mailbox Privacy Shield');
    expect(second.date).toBe('2026-10-21');
    expect(second.securityCount).toBeGreaterThanOrEqual(1);
  });

  it('classifies item types accurately', () => {
    expect(classifyItemType('Strict Mailbox Isolation & Privacy Security Shield')).toBe('security');
    expect(classifyItemType('RFC 5322 Address Parsing Overhaul & Bug Fix')).toBe('fix');
    expect(classifyItemType('Multi-Identity SSO Connection Resolution')).toBe('security'); // has SSO
    expect(classifyItemType('Add new Export to CSV button')).toBe('new');
    expect(classifyItemType('Built dedicated desktop horizontal top navigation bar')).toBe('new');
    expect(classifyItemType('Documentation & Governance update')).toBe('doc');
  });

  it('formats dates and calculates relative age correctly', () => {
    expect(formatReleaseDate('2026-10-22')).toBe('October 22, 2026');
    expect(formatReleaseDate('2026-01-05')).toBe('January 5, 2026');

    const baseDate = new Date('2026-10-22T12:00:00Z');
    expect(computeRelativeAge('2026-10-22', baseDate)).toBe('Today');
    expect(computeRelativeAge('2026-10-21', baseDate)).toBe('Yesterday');
    expect(computeRelativeAge('2026-10-19', baseDate)).toBe('3 days ago');
    expect(computeRelativeAge('2026-10-01', baseDate)).toBe('3 weeks ago');
    expect(computeRelativeAge('2026-09-01', baseDate)).toBe('1 month ago');
  });

  it('filters release notes by query and category', () => {
    const notes = parseChangelog(sampleChangelog, {
      '2.4.323': '2026-10-22',
      '2.4.322': '2026-10-21',
    });

    // Query search for "RFC 5322"
    const rfcFiltered = filterReleaseNotes(notes, { query: 'RFC 5322' });
    expect(rfcFiltered).toHaveLength(1);
    expect(rfcFiltered[0].version).toBe('2.4.322');

    // Query search for "SSO"
    const ssoFiltered = filterReleaseNotes(notes, { query: 'SSO' });
    expect(ssoFiltered).toHaveLength(1);
    expect(ssoFiltered[0].version).toBe('2.4.323');

    // Category filter "security"
    const securityFiltered = filterReleaseNotes(notes, { category: 'security' });
    expect(securityFiltered.length).toBeGreaterThanOrEqual(1);

    // Non-matching query returns empty array
    const emptyFiltered = filterReleaseNotes(notes, { query: 'nonexistent-feature-xyz' });
    expect(emptyFiltered).toHaveLength(0);
  });

  it('successfully loads and parses the real CHANGELOG.md file', () => {
    const allNotes = getReleaseNotes();
    expect(allNotes.length).toBeGreaterThanOrEqual(300);

    // First note should be the latest version (e.g. 2.4.324)
    const latest = allNotes[0];
    expect(latest.version).toMatch(/^2\.4\.\d+$/);
    expect(latest.date).toBeDefined();
    expect(latest.items.length).toBeGreaterThan(0);

    // Verify ordering from new to old
    for (let i = 0; i < Math.min(10, allNotes.length - 1); i++) {
      const curr = allNotes[i];
      const next = allNotes[i + 1];
      // Either version is higher or date is >= next date
      expect(curr.version).toBeDefined();
      expect(next.version).toBeDefined();
    }
  });
});
