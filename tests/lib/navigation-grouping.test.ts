import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('Issue 312: Semantic Navigation Grouping in AppNav', () => {
  it('organizes navigation items into collapsible semantic sections with active route awareness', () => {
    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');

    // Verifies collapsible section containers with opened and onChange props
    expect(nav).toContain('label="Outreach & Content"');
    expect(nav).toContain('opened={outreachOpen}');
    expect(nav).toContain('onChange={setOutreachOpen}');

    expect(nav).toContain('label="Analytics"');
    expect(nav).toContain('opened={analyticsOpen}');
    expect(nav).toContain('onChange={setAnalyticsOpen}');

    expect(nav).toContain('label="Settings"');
    expect(nav).toContain('opened={settingsOpen}');
    expect(nav).toContain('onChange={setSettingsOpen}');

    expect(nav).toContain('label="Admin"');
    expect(nav).toContain('opened={adminOpen}');
    expect(nav).toContain('onChange={setAdminOpen}');

    // Verifies auto-expansion state detection based on pathname
    expect(nav).toContain('isOutreachActive = pathname.includes(\'/outreach/\')');
    expect(nav).toContain('isAnalyticsActive = pathname.includes(\'/forecast/\')');
    expect(nav).toContain('isSettingsActive = pathname.includes(\'/salessettings/\')');
    expect(nav).toContain('isAdminActive = pathname.startsWith(\'/admin/\')');
  });

  it('keeps Core Workspace items permanently visible at top level', () => {
    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');

    expect(nav).toContain('label="Today"');
    expect(nav).toContain('label="Inbox"');
    expect(nav).toContain('label="Pipeline"');
    expect(nav).toContain('label="Contacts"');
    expect(nav).toContain('label="Accounts"');
  });
});
