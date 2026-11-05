import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Bare Workspace Routes Smart Resolution', () => {
  const routes = [
    'today',
    'inbox',
    'sales',
    'contacts',
    'accounts',
    'forecast',
    'reports',
    'battlecards',
    'automation',
    'documents',
    'salessettings',
  ];

  for (const r of routes) {
    it(`provides root page.tsx redirecting /${r} to /${r}/[brand]`, () => {
      const pagePath = path.resolve(process.cwd(), `app/${r}/page.tsx`);
      expect(fs.existsSync(pagePath)).toBe(true);
      const content = fs.readFileSync(pagePath, 'utf8');
      expect(content).toContain('resolveUserPrimaryBrand');
      expect(content).toContain(`redirect(\`/${r}/\${brand}\`)`);
    });
  }
});
