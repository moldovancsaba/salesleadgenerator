import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('Issue 314: Omnichannel Inbox Polish & Hover Quick-Action Strip', () => {
  it('renders high-contrast unread accent borders on thread cards', () => {
    const inbox = readFileSync(join(root, 'app', 'inbox', '[brand]', 'inbox-client.tsx'), 'utf8');

    // Verifies unread accent bar styling
    expect(inbox).toContain("borderLeft: !t.isRead");
    expect(inbox).toContain("'4px solid var(--gds-vibe-primary, var(--mantine-color-indigo-6))'");
  });

  it('renders hover quick-action strip for instant thread triage (Archive, Mark Unread)', () => {
    const inbox = readFileSync(join(root, 'app', 'inbox', '[brand]', 'inbox-client.tsx'), 'utf8');

    // Verifies quick actions in thread item header
    expect(inbox).toContain('handleToggleRead(t.id, t.isRead, e)');
    expect(inbox).toContain('handleToggleArchive(t.id, t.isArchived, e)');
    expect(inbox).toContain('Mark as unread');
    expect(inbox).toContain('Mark as read');
    expect(inbox).toContain('Archive thread');
  });
});
