import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('desktop and tablet navigation affordances', () => {
  it('includes horizontal top navigation links in AppHeader', () => {
    const content = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(content).toContain('visibleFrom="sm"');
    expect(content).toContain('Today');
    expect(content).toContain('Pipeline');
    expect(content).toContain('Table');
    expect(content).toContain('Backlog');
    expect(content).toContain('Contacts');
    expect(content).toContain('Reports');
    expect(content).toContain('Forecast');
    expect(content).toContain('Settings');
  });

  it('includes command launcher trigger affordance in AppHeader', () => {
    const content = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(content).toContain('useCommandLauncher');
    expect(content).toContain('launcher.open()');
    expect(content).toContain('⌘K');
  });

  it('includes inline view SegmentedControl switcher in sales page client', () => {
    const content = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(content).toContain('SegmentedControl');
    expect(content).toContain("{ label: 'Board', value: 'kanban' }");
    expect(content).toContain("{ label: 'Table', value: 'table' }");
    expect(content).toContain("{ label: 'Backlog', value: 'backlog' }");
    expect(content).toContain("{ label: 'Metrics', value: 'metrics' }");
  });

  it('gates PwaSetup gesture cancellation to compact mobile standalone only', () => {
    const content = readFileSync(join(root, 'app', 'components', 'PwaSetup.tsx'), 'utf8');
    expect(content).toContain('isMobileStandalone');
    expect(content).toContain('window.innerWidth < 768');
    expect(content).toContain("window.matchMedia('(display-mode: standalone)').matches");
  });

  it('configures responsive grid cols for tablet portrait on Today view', () => {
    const content = readFileSync(join(root, 'app', 'today', '[brand]', 'today-client.tsx'), 'utf8');
    expect(content).toContain('cols={{ base: 2, sm: 3, md: 5 }}');
  });
});
