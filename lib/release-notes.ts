import fs from 'fs';
import path from 'path';
import { parseChangelog, ReleaseNote } from './release-notes-parser';
import { RELEASE_DATES } from './release-notes-dates';

let cachedNotes: ReleaseNote[] | null = null;
let lastReadTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in memory

export function getReleaseNotes(): ReleaseNote[] {
  const now = Date.now();
  if (cachedNotes && now - lastReadTime < CACHE_TTL_MS) {
    return cachedNotes;
  }

  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
    if (fs.existsSync(changelogPath)) {
      const content = fs.readFileSync(changelogPath, 'utf8');
      cachedNotes = parseChangelog(content, RELEASE_DATES);
      lastReadTime = now;
      return cachedNotes;
    }
  } catch (err) {
    console.error('Failed to read CHANGELOG.md:', err);
  }

  // Fallback to empty if file not accessible
  return cachedNotes || [];
}

export function getReleaseNoteByVersion(version: string): ReleaseNote | null {
  const notes = getReleaseNotes();
  const cleanVersion = version.replace(/^v/, '');
  return notes.find((n) => n.version === cleanVersion) || null;
}
