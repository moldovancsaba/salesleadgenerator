import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('Public Landing Chrome Isolation', () => {
  it('hides internal authenticated sidebar and header on root landing page', () => {
    const layout = readFileSync(join(root, 'app', 'components', 'AppLayout.tsx'), 'utf8');
    expect(layout).toContain("pathname === '/'");
  });
});
