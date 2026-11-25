import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANDING_CONTENT } from '@/content/landing';

const root = process.cwd();

describe('Wave 1A Launch Label, Today Navigation, and Needs Reply Toggle (Issue 354)', () => {
  it('uses Login on launch page, landing content, and sidebar nav', () => {
    expect(LANDING_CONTENT.navigation.signInLabel).toBe('Login');
    const pageSrc = readFileSync(join(root, 'app', 'page.tsx'), 'utf8');
    expect(pageSrc).not.toContain('Sign in with SSO');
    expect(pageSrc).toContain('preferredStartScreen');
    const navSrc = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(navSrc).toContain('label="Login"');
  });

  it('links Today View buttons to ?leadId= and accepts both ?leadId= and legacy ?lead= on Sales board', () => {
    const todaySrc = readFileSync(join(root, 'app', 'today', '[brand]', 'today-client.tsx'), 'utf8');
    expect(todaySrc).not.toContain('?lead=${');
    expect(todaySrc).toContain('?leadId=${encodeURIComponent(item.leadId)}');
    expect(todaySrc).toContain('?leadId=${encodeURIComponent(task.leadId)}');
    expect(todaySrc).toContain('?leadId=${encodeURIComponent(deal.leadId)}');

    const salesSrc = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(salesSrc).toContain("searchParams.get('leadId') || searchParams.get('lead')");
  });

  it('supports per-workspace per-user Needs Reply visibility toggle while keeping unread badges intact', () => {
    const inboxSrc = readFileSync(join(root, 'app', 'inbox', '[brand]', 'inbox-client.tsx'), 'utf8');
    expect(inboxSrc).toContain('const hideNeedsReply = Boolean(hideNeedsReplyByBrand?.[brand])');
    expect(inboxSrc).toContain('{!hideNeedsReply && (');
    expect(inboxSrc).toContain('{!hideNeedsReply && t.needsReply && (');
    expect(inboxSrc).toContain('counts.unread > 0');

    const settingsModalSrc = readFileSync(join(root, 'app', 'components', 'UserSettingsModal.tsx'), 'utf8');
    expect(settingsModalSrc).toContain('Default Start Screen');
    expect(settingsModalSrc).toContain('hideNeedsReply');
  });
});
