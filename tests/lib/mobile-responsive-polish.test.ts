import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Mobile Responsive Polish & Spacing Audit (Issue 309)', () => {
  const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const client = readFileSync(join(process.cwd(), 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');

  it('supports safe-area padding for mobile viewport and drawer/modal content', () => {
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('.mantine-Drawer-content');
  });

  it('provides smooth horizontal scrolling class for quick filters', () => {
    expect(css).toContain('.quick-filters-scroll');
    expect(css).toContain('-webkit-overflow-scrolling: touch');
    expect(client).toContain('quick-filters-scroll');
  });

  it('enforces responsive mobile control width on SegmentedControl for screens under 768px', () => {
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain('.mantine-SegmentedControl-root');
  });
});
