import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseChangelog, filterReleaseNotes } from '../../lib/release-notes-parser';

const root = join(__dirname, '..', '..');

describe('Issue 317: Client-independent What\'s New and SemVer descending order', () => {
  it('serves /whats-new directly without brand parameter or brand redirect', () => {
    const page = readFileSync(join(root, 'app', 'whats-new', 'page.tsx'), 'utf8');

    expect(page).toContain("WhatsNewClient");
    expect(page).not.toContain("redirect(`/whats-new/${targetBrand}`)");
  });

  it('links AppNav and AppHeader directly to /whats-new', () => {
    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain('href="/whats-new"');

    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(header).toContain('href="/whats-new"');
  });

  it('parses changelog in strict semver descending order (newest to oldest)', () => {
    const sampleChangelog = `
# Changelog

## 2.4.350
### Feature A
- **A**: item A

## 2.4.358
### Feature C
- **C**: item C

## 2.4.355
### Feature B
- **B**: item B
`;
    const notes = parseChangelog(sampleChangelog);
    expect(notes.map((n) => n.version)).toEqual(['2.4.358', '2.4.355', '2.4.350']);
  });

  it('dynamically dates unmapped releases with current date instead of stale 2026-10-22 fallback', () => {
    const sampleChangelog = `
## 2.4.999
### Test Unmapped Version
- **Test**: unmapped
`;
    const todayIso = new Date().toISOString().slice(0, 10);
    const notes = parseChangelog(sampleChangelog);
    expect(notes[0].date).toBe(todayIso);
  });
});
