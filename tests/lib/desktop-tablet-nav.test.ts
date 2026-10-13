import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('desktop and tablet navigation affordances', () => {
  it('keeps AppHeader clean with drawer launcher, title, and organization switcher', () => {
    const content = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(content).toContain('<AppNav />');
    expect(content).toContain('Sales Lead Generator');
    expect(content).toContain('activeBrand');
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

  it('supports organization switcher navigation in AppHeader and AppNav', () => {
    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(header).toContain('router.push(`/sales/${newBrand}`)');

    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain('router.push(`/sales/${nextBrand}`)');
  });

  it('keeps modal open and refreshes board on in-place actions like ASSIGN in sales-page-client', () => {
    const content = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(content).toContain("if (action === 'ACCEPT' || action === 'DECLINE')");
    expect(content).toContain('setRefreshKey((k) => k + 1)');
  });

  it('displays Assignee in card tier metadata when lead is assigned', () => {
    const content = readFileSync(join(root, 'app', 'card.tsx'), 'utf8');
    expect(content).toContain("label: 'Assignee'");
    expect(content).toContain('lead.assignedToEmail');
  });

  it('triggers assignment immediately on change and checks super admin role in detail modal', () => {
    const content = readFileSync(join(root, 'app', 'detail.tsx'), 'utf8');
    expect(content).toContain('handleAssign(next)');
    expect(content).toContain('isSuperAdmin');
  });

  it('safeguards columnStates in KanbanBoard against missing column definitions', () => {
    const content = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
    expect(content).toContain('const colState = columnStates[col.key] ||');
    expect(content).toContain('const colState = columnStates[column.id as KanbanColumn] ||');
  });

  it('displays readable error message in global error boundary', () => {
    const content = readFileSync(join(root, 'app', 'error.tsx'), 'utf8');
    expect(content).toContain('{error?.message && (');
  });

  it('renders AppLayout with docked AppNavSidebar on desktop/tablet', () => {
    const layout = readFileSync(join(root, 'app', 'components', 'AppLayout.tsx'), 'utf8');
    expect(layout).toContain('<AppHeader />');
    expect(layout).toContain('<AppNavSidebar />');
    expect(layout).toContain('{children}');
  });

  it('provides AppNavSidebar with collapsible hide affordance', () => {
    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain('export function AppNavSidebar()');
    expect(nav).toContain('sidebarOpen');
    expect(nav).toContain('setSidebarOpen(false)');
    expect(nav).toContain('<AppNavContent');
  });

  it('prevents React error 185 infinite loops via registerCommandsRef and lastVisibleLeadIdsRef', () => {
    const salesClient = readFileSync(join(root, 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');
    expect(salesClient).toContain('const registerCommandsRef = useRef(registerCommands)');
    expect(salesClient).toContain('handleVisibleLeadsChange');

    const kanban = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
    expect(kanban).toContain('const lastVisibleLeadIdsRef = useRef<string>');
  });

  it('keeps navigation bar and header sticky without scrolling off screen', () => {
    const globals = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
    expect(globals).toContain('overflow-x: clip;');
    expect(globals).not.toContain('overflow-x: hidden;');

    const nav = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(nav).toContain("position: 'sticky'");
    expect(nav).toContain('alignSelf: \'flex-start\'');
    expect(nav).toContain('top: 48');

    const header = readFileSync(join(root, 'app', 'components', 'AppHeader.tsx'), 'utf8');
    expect(header).toContain("position: 'sticky'");
    expect(header).toContain('top: 0');
    expect(header).toContain("height: '48px'");

    const layout = readFileSync(join(root, 'app', 'components', 'AppLayout.tsx'), 'utf8');
    expect(layout).toContain("alignItems: 'flex-start'");
  });

  it('enforces identical, uniform 320px column width across uncollapsed Kanban columns', () => {
    const globals = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
    expect(globals).toContain('[data-gds-kanban-column]:not([data-gds-kanban-column-collapsed="true"])');
    expect(globals).toContain('width: 320px !important;');
    expect(globals).toContain('min-width: 320px !important;');
    expect(globals).toContain('max-width: 320px !important;');

    const kanban = readFileSync(join(root, 'app', 'kanban.tsx'), 'utf8');
    expect(kanban).toContain('columnWidth={320}');
  });
});
