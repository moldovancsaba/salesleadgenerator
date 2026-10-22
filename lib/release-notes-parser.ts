// Release notes parser for What's New blog (issue 269)
import { RELEASE_DATES } from './release-notes-dates';

export type ReleaseCategory = 'all' | 'new' | 'fix' | 'security';

export interface ReleaseItem {
  title: string;
  type: 'new' | 'fix' | 'security' | 'doc' | 'other';
  component?: string;
  details: string[];
}

export interface ReleaseNote {
  version: string;
  title: string;
  date: string; // ISO date 'YYYY-MM-DD'
  formattedDate: string; // e.g. 'October 22, 2026'
  relativeAge: string; // e.g. 'Today', '2 days ago'
  items: ReleaseItem[];
  newCount: number;
  fixCount: number;
  securityCount: number;
  rawMarkdown: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatReleaseDate(isoDate: string): string {
  if (!isoDate || !isoDate.includes('-')) return isoDate || 'Recent';
  const parts = isoDate.split('-');
  if (parts.length < 3) return isoDate;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(monthIdx) || isNaN(day) || monthIdx < 0 || monthIdx > 11) return isoDate;
  return `${MONTH_NAMES[monthIdx]} ${day}, ${year}`;
}

export function computeRelativeAge(isoDate: string, baseDate?: Date): string {
  if (!isoDate) return 'Recently';
  const target = new Date(isoDate);
  if (isNaN(target.getTime())) return 'Recently';
  const now = baseDate || new Date();
  
  // Calculate difference in calendar days
  const diffTime = now.getTime() - target.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) === 1 ? '' : 's'} ago`;
}

export function classifyItemType(text: string): 'new' | 'fix' | 'security' | 'doc' | 'other' {
  const lower = text.toLowerCase();
  
  // Security and privacy check
  if (
    lower.includes('security') ||
    lower.includes('privacy') ||
    lower.includes('leak') ||
    lower.includes('shield') ||
    lower.includes('isolation') ||
    lower.includes('isolate') ||
    lower.includes('credential') ||
    lower.includes('token') ||
    lower.includes('authorization') ||
    lower.includes('auth') ||
    lower.includes('sso') ||
    lower.includes('fail-closed')
  ) {
    return 'security';
  }

  // Bug fixes and error remediation
  if (
    lower.includes('fix') ||
    lower.includes('bug') ||
    lower.includes('prevent') ||
    lower.includes('remedy') ||
    lower.includes('remediated') ||
    lower.includes('clean') ||
    lower.includes('cleaned') ||
    lower.includes('correct') ||
    lower.includes('corrected') ||
    lower.includes('eliminate') ||
    lower.includes('eliminated') ||
    lower.includes('crash') ||
    lower.includes('error') ||
    lower.includes('resolve') ||
    lower.includes('resolved') ||
    lower.includes('harden') ||
    lower.includes('hardened') ||
    lower.includes('mojibake') ||
    lower.includes('mangling') ||
    lower.includes('fallback')
  ) {
    return 'fix';
  }

  // New features and enhancements
  if (
    lower.includes('feat') ||
    lower.includes('add') ||
    lower.includes('added') ||
    lower.includes('built') ||
    lower.includes('introduce') ||
    lower.includes('introduced') ||
    lower.includes('support') ||
    lower.includes('new') ||
    lower.includes('enable') ||
    lower.includes('surfaced') ||
    lower.includes('implement') ||
    lower.includes('implemented') ||
    lower.includes('unify') ||
    lower.includes('unifying') ||
    lower.includes('migration') ||
    lower.includes('enhancement') ||
    lower.includes('redesign') ||
    lower.includes('interactive')
  ) {
    return 'new';
  }

  if (
    lower.includes('doc') ||
    lower.includes('readme') ||
    lower.includes('changelog') ||
    lower.includes('handover') ||
    lower.includes('guide') ||
    lower.includes('rule')
  ) {
    return 'doc';
  }

  return 'other';
}

function extractComponent(text: string): string | undefined {
  const match = text.match(/\(([^)]+)\)/);
  if (match) {
    const raw = match[1].trim().replace(/`/g, '');
    // If it's a file path like app/lib/inbox-store.ts, get basename or directory
    if (raw.includes('/') || raw.includes('.')) {
      const parts = raw.split(/,\s*/);
      return parts.map(p => p.split('/').pop()?.replace(/\.(tsx?|jsx?|md)$/, '') || p).join(', ');
    }
    return raw;
  }
  return undefined;
}

export function cleanReleaseText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/:\*\*$/, '')
    .replace(/\*\*:?$/, '')
    .replace(/:$/, '')
    .trim();
}

export function parseChangelog(
  content: string,
  dateOverrides: Record<string, string> = RELEASE_DATES,
  baseDate?: Date
): ReleaseNote[] {
  if (!content) return [];

  // Split by markdown version headers '## 2.4.xxx'
  const sections = content.split(/\n(?=##\s+\d+\.\d+\.\d+)/);
  const releaseNotes: ReleaseNote[] = [];

  for (const section of sections) {
    const lines = section.trim().split('\n');
    if (lines.length === 0) continue;

    const versionMatch = lines[0].match(/^##\s+(\d+\.\d+\.\d+)/);
    if (!versionMatch) continue;

    const version = versionMatch[1];
    let title = '';
    const contentLines: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!title && line.startsWith('### ')) {
        title = line.replace(/^###\s+/, '').trim();
      } else {
        contentLines.push(line);
      }
    }

    if (!title) {
      title = `Release ${version}`;
    }

    // Determine release date
    const isoDate = dateOverrides[version] || (baseDate ? baseDate.toISOString().slice(0, 10) : '2026-10-22');
    const formattedDate = formatReleaseDate(isoDate);
    const relativeAge = computeRelativeAge(isoDate, baseDate);

    // Parse bullet items
    const items: ReleaseItem[] = [];
    let currentItem: ReleaseItem | null = null;

    for (const rawLine of contentLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      // Top level bullet: '- **Feature Name**:' or '* **Feature Name**:'
      if (/^[-*]\s+\*\*/.test(trimmed) || /^[-*]\s+\[.*?\]/.test(trimmed)) {
        if (currentItem) {
          items.push(currentItem);
        }
        const rawTitle = trimmed.replace(/^[-*]\s+/, '').trim();
        const itemTitle = cleanReleaseText(rawTitle);
        const itemType = classifyItemType(itemTitle);
        const comp = extractComponent(rawTitle);

        currentItem = {
          title: itemTitle,
          type: itemType,
          component: comp,
          details: [],
        };
      } else if (currentItem) {
        // Sub-bullet or explanation
        const rawDetail = trimmed.replace(/^[-*]\s+/, '').trim();
        const detailLine = cleanReleaseText(rawDetail);
        if (detailLine) {
          currentItem.details.push(detailLine);
          // If the item was classified as other or doc, but a sub-bullet clearly indicates a fix or feature, refine it
          if (currentItem.type === 'other' || currentItem.type === 'doc') {
            const refined = classifyItemType(detailLine);
            if (refined === 'fix' || refined === 'security' || refined === 'new') {
              currentItem.type = refined;
            }
          }
        }
      }
    }

    if (currentItem) {
      items.push(currentItem);
    }

    const newCount = items.filter(i => i.type === 'new').length;
    const fixCount = items.filter(i => i.type === 'fix').length;
    const securityCount = items.filter(i => i.type === 'security').length;

    releaseNotes.push({
      version,
      title,
      date: isoDate,
      formattedDate,
      relativeAge,
      items,
      newCount,
      fixCount,
      securityCount,
      rawMarkdown: section.trim(),
    });
  }

  // Ensure sorted by version or date descending (already in CHANGELOG.md descending order)
  return releaseNotes;
}

export function filterReleaseNotes(
  notes: ReleaseNote[],
  options: {
    query?: string;
    category?: ReleaseCategory;
  } = {}
): ReleaseNote[] {
  const { query, category = 'all' } = options;
  const cleanQuery = query?.trim().toLowerCase();

  return notes.filter((note) => {
    // 1. Category filter
    if (category === 'new' && note.newCount === 0) return false;
    if (category === 'fix' && note.fixCount === 0) return false;
    if (category === 'security' && note.securityCount === 0) return false;

    // 2. Query filter
    if (cleanQuery) {
      const matchVersion = note.version.toLowerCase().includes(cleanQuery);
      const matchTitle = note.title.toLowerCase().includes(cleanQuery);
      const matchDate = note.date.includes(cleanQuery) || note.formattedDate.toLowerCase().includes(cleanQuery);
      const matchItems = note.items.some(
        item => item.title.toLowerCase().includes(cleanQuery) ||
                item.details.some(d => d.toLowerCase().includes(cleanQuery))
      );
      if (!matchVersion && !matchTitle && !matchDate && !matchItems) {
        return false;
      }
    }

    return true;
  });
}
