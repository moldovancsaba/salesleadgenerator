import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Docs and UI Affordance Consistency (Issue #324)', () => {
  it('AppHeader links version badge directly to /whats-new without brand nesting', () => {
    const headerPath = path.resolve(process.cwd(), 'app/components/AppHeader.tsx');
    const headerSrc = fs.readFileSync(headerPath, 'utf8');
    expect(headerSrc).toContain('href="/whats-new"');
    expect(headerSrc).not.toContain('href={`/whats-new/${activeBrand}`}');
  });

  it('WhatsNewClient generates canonical /whats-new anchor links', () => {
    const clientPath = path.resolve(process.cwd(), 'app/whats-new/[brand]/whats-new-client.tsx');
    const clientSrc = fs.readFileSync(clientPath, 'utf8');
    expect(clientSrc).toContain('`${window.location.origin}/whats-new#${slug}`');
    expect(clientSrc).not.toContain('/whats-new/${brand}#');
  });

  it('User Guide documents canonical production domain and all 5 tenants', () => {
    const guidePath = path.resolve(process.cwd(), 'docs/USER_GUIDE.md');
    const guideSrc = fs.readFileSync(guidePath, 'utf8');
    expect(guideSrc).toContain('https://sales.haho.ai');
    expect(guideSrc).toContain('CogMap');
    expect(guideSrc).toContain('Seyu');
    expect(guideSrc).toContain('DVSC');
    expect(guideSrc).toContain('Padel Africa');
    expect(guideSrc).toContain('EGM');
    expect(guideSrc).toContain('/salessettings/[client]?tab=products');
  });

  it('README documents canonical production domain and What\'s New route', () => {
    const readmePath = path.resolve(process.cwd(), 'README.md');
    const readmeSrc = fs.readFileSync(readmePath, 'utf8');
    expect(readmeSrc).toContain('https://sales.haho.ai');
    expect(readmeSrc).toContain('`/whats-new`');
    expect(readmeSrc).toContain('**Version:** 2.4.366');
  });
});
