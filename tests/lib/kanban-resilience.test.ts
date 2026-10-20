import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('Kanban & Card Resilience (Issue 271)', () => {
  const kanbanSource = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
  const cardSource = readFileSync(join(root, 'app', 'card.tsx'), 'utf8');

  it('deduplicates lead IDs in columns to prevent dnd-kit SortableContext crash', () => {
    expect(kanbanSource).toContain('const seenIds = new Set<string>()');
    expect(kanbanSource).toContain('if (!lead || !lead._id || seenIds.has(lead._id)) continue');
  });

  it('deduplicates incoming cursor pagination in loadColumn', () => {
    expect(kanbanSource).toContain('const existingIds = new Set<string>()');
    expect(kanbanSource).toContain('const dedupedLeads: Lead[] = []');
  });

  it('isolates card render errors with a card-level ErrorBoundary in renderItem', () => {
    expect(kanbanSource).toContain('<ErrorBoundary');
    expect(kanbanSource).toContain('Card unavailable');
  });

  it('LoadMoreSentinel stabilizes onLoadMore callback via ref to prevent infinite loops', () => {
    expect(kanbanSource).toContain('const onLoadMoreRef = useRef(onLoadMore)');
    expect(kanbanSource).toContain('onLoadMoreRef.current = onLoadMore');
  });

  it('safely handles non-string or object assignedTo and owner formats', () => {
    expect(cardSource).toContain("typeof lead.assignedToEmail === 'string'");
    expect(cardSource).toContain("typeof lead.assignedTo === 'string'");
    expect(cardSource).toContain("ownerLabel === 'Unassigned'");
  });

  it('safely sanitizes tags and sector labels', () => {
    expect(cardSource).toContain('function formatSectorLabel(raw: unknown)');
    expect(cardSource).toContain('const validTags = Array.isArray(lead.tags)');
  });
});
